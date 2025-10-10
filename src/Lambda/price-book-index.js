const AWS = require('aws-sdk');
const { Client } = require('pg');
const { v4: uuidv4 } = require('uuid');
const s3 = new AWS.S3();

// Cache templates
let templateCache = {};

async function getTemplate(key) {
    if (templateCache[key]) return templateCache[key];

    try {
        const obj = await s3.getObject({
            Bucket: 'prism-lambda-templates',
            Key: key
        }).promise();

        templateCache[key] = obj.Body.toString();
        return templateCache[key];
    } catch (error) {
        console.error(`Failed to load template ${key}:`, error);
        throw new Error(`Template ${key} not found`);
    }
}

function renderTemplate(template, data) {
    // Handle conditional blocks {{#KEY}} content {{/KEY}}
    template = template.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (match, key, content) => {
        const value = data[key];
        return (value && value !== false && value !== 0 && value !== '' && value !== null && value !== undefined) ? content : '';
    });

    // Handle inverted conditional blocks {{^KEY}} content {{/KEY}}
    template = template.replace(/\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (match, key, content) => {
        const value = data[key];
        return (!value || value === false || value === 0 || value === '' || value === null || value === undefined) ? content : '';
    });

    // Handle simple variable substitution {{KEY}}
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        const value = data[key];
        return value !== undefined && value !== null ? String(value) : '';
    });
}

// Generate filters HTML
async function generateFiltersHTML(client) {
    try {
        const filtersTemplate = await getTemplate('price-book-filters.html');

        // Get PBM configurations
        const configQuery = `
            SELECT config_type, config_code, display_name
            FROM application.prism_system_config
            WHERE config_type IN ('pbm') AND is_active = true
            ORDER BY config_type, display_order
        `;

        const configResult = await client.query(configQuery);
        const pbmOptions = configResult.rows
            .map((row, index) => `<option value="${row.config_code}" ${index === 0 ? 'selected' : ''}>${row.display_name}</option>`)
            .join('');

        // Config Type options (PRODUCTION/MODELING)
        const configTypeOptions = [
            '<option value="">All Types</option>',
            '<option value="PRODUCTION">Production</option>',
            '<option value="MODELING" selected>Modeling</option>'
        ].join('');

        // Status options
        const statusOptions = [
            '<option value="active" selected>Active</option>',
            '<option value="inactive">Inactive</option>',
            '<option value="all">All</option>'
        ].join('');

        const filterData = {
            PBM_OPTIONS: pbmOptions,
            CONFIG_TYPE_OPTIONS: configTypeOptions,
            STATUS_OPTIONS: statusOptions
        };

        return renderTemplate(filtersTemplate, filterData);

    } catch (error) {
        console.error('Error generating filters:', error);
        return '<div class="text-red-500">Error loading filters</div>';
    }
}

// Build filter query
function buildFilterQuery(filters) {
    const conditions = [];
    const params = [];

    function hasValue(val) {
        return val && val.trim() !== '';
    }

    function addCondition(condition, value) {
        params.push(value);
        conditions.push(condition.replace('?', `$${params.length}`));
    }

    // Base conditions
    if (hasValue(filters.pbm_filter)) {
        addCondition('pbm_code = ?', filters.pbm_filter);
    }

    if (hasValue(filters.config_type_filter)) {
        addCondition('config_type = ?', filters.config_type_filter);
    }

    // Status filter
    if (filters.status_filter === 'inactive') {
        addCondition('is_active = ?', false);
    } else if (filters.status_filter === 'active') {
        addCondition('is_active = ?', true);
    }
    // 'all' means no filter

    if (hasValue(filters.name_search)) {
        addCondition('LOWER(name) LIKE LOWER(?)', `%${filters.name_search.trim()}%`);
    }

    const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

    return {
        whereClause,
        params
    };
}

// Get additional parameters for a specific PBM
async function getAdditionalParameters(client, pbmCode) {
    try {
        const query = `
            WITH pbm_specific_params AS (
                SELECT DISTINCT parent_code
                FROM application.prism_system_config
                WHERE config_type = 'price_parameters'
                  AND parent_code IS NOT NULL
                  AND pbm_code = $1
                  AND is_active = true
            ),
            param_values AS (
                SELECT
                    psc.parent_code,
                    psc.config_code,
                    psc.display_name,
                    psc.display_order,
                    psc.pbm_code,
                    psc.is_default,
                    psc.description
                FROM application.prism_system_config psc
                WHERE psc.config_type = 'price_parameters'
                  AND psc.parent_code IS NOT NULL
                  AND psc.is_active = true
                  AND (
                      (psc.parent_code IN (SELECT parent_code FROM pbm_specific_params)
                       AND psc.pbm_code = $1)
                      OR
                      (psc.parent_code NOT IN (SELECT parent_code FROM pbm_specific_params)
                       AND psc.pbm_code IS NULL)
                  )
            )
            SELECT
                parent.config_code as parameter_code,
                parent.display_name as parameter_name,
                parent.display_order as parameter_order,
                parent.validation_rules,
                parent.description as parameter_description,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'code', pv.config_code,
                            'label', pv.display_name,
                            'is_default', pv.is_default,
                            'pbm_specific', CASE WHEN pv.pbm_code IS NOT NULL THEN true ELSE false END,
                            'description', pv.description
                        ) ORDER BY pv.display_order
                    ) FILTER (WHERE pv.config_code IS NOT NULL),
                    '[]'::json
                ) as valid_values
            FROM application.prism_system_config parent
            LEFT JOIN param_values pv ON pv.parent_code = parent.config_code
            WHERE parent.config_type = 'price_parameters'
              AND parent.parent_code IS NULL
              AND parent.is_active = true
              AND parent.config_code != 'pricing_type'
            GROUP BY
                parent.config_code,
                parent.display_name,
                parent.display_order,
                parent.validation_rules,
                parent.description
            ORDER BY parent.display_order
        `;

        const result = await client.query(query, [pbmCode]);
        return result.rows;
    } catch (error) {
        console.error('Error getting additional parameters:', error);
        return [];
    }
}

// Create new price book configuration
async function createPriceBook(client, formData) {
    const dbClient = client;

    try {
        await dbClient.query('BEGIN');

        console.log('Creating new price book with data:', formData);

        // Parse additional parameters
        let additionalParameters = {};
        if (formData.additional_parameters) {
            try {
                additionalParameters = typeof formData.additional_parameters === 'string'
                    ? JSON.parse(formData.additional_parameters)
                    : formData.additional_parameters;
            } catch (e) {
                console.error('Failed to parse additional_parameters:', e);
            }
        }

        // Parse pricing structure
        let pricingStructure = {};
        if (formData.pricing_structure) {
            try {
                pricingStructure = typeof formData.pricing_structure === 'string'
                    ? JSON.parse(formData.pricing_structure)
                    : formData.pricing_structure;
            } catch (e) {
                console.error('Failed to parse pricing_structure:', e);
            }
        }

        // Generate new config_id
        const newConfigId = uuidv4();

        // Validate required fields
        if (!formData.name || !formData.pbm_code || !formData.config_type) {
            return {
                success: false,
                error: 'Missing required fields: name, pbm_code, and config_type are required'
            };
        }

        // Prepare configuration data
        const configData = {
            config_id: newConfigId,
            version: 1,
            name: formData.name.trim(),
            description: formData.description || null,
            config_type: formData.config_type,
            pbm_code: formData.pbm_code,
            pricing_structure: JSON.stringify(pricingStructure),
            additional_parameters: JSON.stringify(additionalParameters),
            effective_from: formData.effective_from || new Date(),
            effective_to: formData.effective_to || '9999-12-31',
            is_active: formData.is_active === 'on' || formData.is_active === 'true' || true,
            created_by: 'system'
        };

        console.log('Final config data:', configData);

        // Insert new configuration
        const insertQuery = `
            INSERT INTO application.prism_price_configuration (
                config_id, version, name, description, config_type, pbm_code,
                pricing_structure, additional_parameters, effective_from, effective_to,
                is_active, created_by
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
            )
            RETURNING id, config_id, version
        `;

        const insertValues = [
            configData.config_id,
            configData.version,
            configData.name,
            configData.description,
            configData.config_type,
            configData.pbm_code,
            configData.pricing_structure,
            configData.additional_parameters,
            configData.effective_from,
            configData.effective_to,
            configData.is_active,
            configData.created_by
        ];

        const insertResult = await dbClient.query(insertQuery, insertValues);
        await dbClient.query('COMMIT');

        console.log('Price book created successfully:', {
            configId: newConfigId,
            version: insertResult.rows[0].version,
            name: configData.name
        });

        return {
            success: true,
            message: 'Price book created successfully',
            configId: newConfigId,
            version: insertResult.rows[0].version
        };

    } catch (error) {
        await dbClient.query('ROLLBACK');
        console.error('Error creating price book:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Update price book configuration (creates new version)
async function updatePriceBook(client, configId, formData) {
    const dbClient = client;

    try {
        await dbClient.query('BEGIN');

        // Get current configuration
        const currentConfigQuery = `
            SELECT * FROM application.prism_price_configuration
            WHERE config_id = $1 AND is_active = true
            ORDER BY version DESC
            LIMIT 1
        `;
        const currentConfigResult = await dbClient.query(currentConfigQuery, [configId]);

        if (currentConfigResult.rows.length === 0) {
            throw new Error('Configuration not found');
        }

        const currentConfig = currentConfigResult.rows[0];

        // Parse additional parameters
        let additionalParameters = {};
        if (formData.additional_parameters) {
            try {
                additionalParameters = typeof formData.additional_parameters === 'string'
                    ? JSON.parse(formData.additional_parameters)
                    : formData.additional_parameters;
            } catch (e) {
                console.error('Failed to parse additional_parameters:', e);
                additionalParameters = currentConfig.additional_parameters || {};
            }
        }

        // Parse pricing structure
        let pricingStructure = {};
        if (formData.pricing_structure) {
            try {
                pricingStructure = typeof formData.pricing_structure === 'string'
                    ? JSON.parse(formData.pricing_structure)
                    : formData.pricing_structure;
            } catch (e) {
                console.error('Failed to parse pricing_structure:', e);
                pricingStructure = currentConfig.pricing_structure || {};
            }
        }

        // Deactivate current version
        await dbClient.query(
            'UPDATE application.prism_price_configuration SET is_active = false WHERE config_id = $1 AND is_active = true',
            [configId]
        );

        // Insert new version
        const insertQuery = `
            INSERT INTO application.prism_price_configuration (
                config_id, version, name, description, config_type, pbm_code,
                pricing_structure, additional_parameters, effective_from, effective_to,
                is_active, created_by, last_modified_by
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
            )
            RETURNING id, version
        `;

        const newVersion = currentConfig.version + 1;
        const insertValues = [
            configId,
            newVersion,
            formData.name || currentConfig.name,
            formData.description || currentConfig.description,
            formData.config_type || currentConfig.config_type,
            formData.pbm_code || currentConfig.pbm_code,
            JSON.stringify(pricingStructure),
            JSON.stringify(additionalParameters),
            formData.effective_from || currentConfig.effective_from,
            formData.effective_to || currentConfig.effective_to,
            formData.is_active === 'on' || formData.is_active === 'true' || true,
            currentConfig.created_by,
            'system'
        ];

        const insertResult = await dbClient.query(insertQuery, insertValues);
        await dbClient.query('COMMIT');

        console.log('Price book updated successfully:', {
            configId,
            oldVersion: currentConfig.version,
            newVersion: insertResult.rows[0].version
        });

        return {
            success: true,
            message: 'Price book updated successfully',
            newVersion: insertResult.rows[0].version
        };

    } catch (error) {
        await dbClient.query('ROLLBACK');
        console.error('Error updating price book:', error);
        throw error;
    }
}

// Delete price book (set is_active to false)
async function deletePriceBook(client, configId) {
    try {
        const deleteQuery = `
            UPDATE application.prism_price_configuration
            SET is_active = false, updated_at = CURRENT_TIMESTAMP
            WHERE config_id = $1 AND is_active = true
        `;

        const result = await client.query(deleteQuery, [configId]);
        return result.rowCount > 0;

    } catch (error) {
        console.error('Failed to delete price book:', error);
        throw error;
    }
}

const handler = async (event) => {
    // Force template cache refresh for debugging
    templateCache = {};

    console.log('🚀 Price Book Lambda started:', {
        method: event.httpMethod,
        path: event.path,
        queryParams: event.queryStringParameters
    });

    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,Authorization,X-Requested-With,Accept',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Content-Type': 'text/html'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    const client = new Client({
        host: process.env.DB_HOST,
        port: 5432,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();

        const path = event.path || '';
        const method = event.httpMethod;

        // Handle filters request
        if (method === 'GET' && event.queryStringParameters?.component === 'filters') {
            console.log('🔍 Filters request');
            const filtersHTML = await generateFiltersHTML(client);
            await client.end();

            return {
                statusCode: 200,
                headers,
                body: filtersHTML
            };
        }

        // Handle get parameters request
        if (method === 'GET' && event.queryStringParameters?.get_parameters) {
            console.log('🔍 Get parameters request');
            const pbmCode = event.queryStringParameters.pbm_code;

            if (!pbmCode) {
                return {
                    statusCode: 400,
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'PBM code required' })
                };
            }

            const parameters = await getAdditionalParameters(client, pbmCode);
            await client.end();

            return {
                statusCode: 200,
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify(parameters)
            };
        }

        // Handle create request
        if (method === 'POST' && event.queryStringParameters?.action === 'create') {
            console.log('➕ Create price book request');

            let formData = {};
            if (event.body) {
                if (event.headers['Content-Type']?.includes('application/json')) {
                    formData = JSON.parse(event.body);
                } else {
                    const params = new URLSearchParams(event.body);
                    for (const [key, value] of params) {
                        formData[key] = value;
                    }
                }
            }

            const result = await createPriceBook(client, formData);
            await client.end();

            if (result.success) {
                return {
                    statusCode: 200,
                    headers: { ...headers, 'HX-Trigger': 'priceBookCreated' },
                    body: '<div class="text-green-600">Price book created successfully! Refreshing...</div>'
                };
            } else {
                return {
                    statusCode: 400,
                    headers,
                    body: `<div class="text-red-600">Failed to create price book: ${result.error}</div>`
                };
            }
        }

        // Handle update request
        if (method === 'PUT' && event.queryStringParameters?.update) {
            console.log('💾 Update price book request');
            const configId = event.queryStringParameters.update;

            if (!configId) {
                throw new Error('Config ID required');
            }

            let formData = {};
            if (event.body) {
                if (event.headers['Content-Type']?.includes('application/json')) {
                    formData = JSON.parse(event.body);
                } else {
                    const params = new URLSearchParams(event.body);
                    for (const [key, value] of params) {
                        formData[key] = value;
                    }
                }
            }

            const result = await updatePriceBook(client, configId, formData);
            await client.end();

            if (result.success) {
                return {
                    statusCode: 200,
                    headers: { ...headers, 'HX-Trigger': 'priceBookUpdated' },
                    body: '<div class="text-green-600">Price book updated successfully! Refreshing...</div>'
                };
            } else {
                return {
                    statusCode: 400,
                    headers,
                    body: '<div class="text-red-600">Failed to update price book</div>'
                };
            }
        }

        // Handle delete request
        if (method === 'POST' && event.queryStringParameters?.action === 'delete') {
            console.log('🗑️ Delete price book request');
            const configId = event.queryStringParameters?.id;

            if (!configId) {
                return {
                    statusCode: 400,
                    headers,
                    body: '<div class="text-red-600">Config ID required for deletion</div>'
                };
            }

            try {
                const success = await deletePriceBook(client, configId);

                if (success) {
                    console.log('✅ Deleted price book:', configId);
                    await client.end();
                    return {
                        statusCode: 200,
                        headers: { ...headers, 'HX-Trigger': 'priceBookDeleted' },
                        body: '<div class="text-green-600">Price book deleted successfully!</div>'
                    };
                } else {
                    await client.end();
                    return {
                        statusCode: 400,
                        headers,
                        body: '<div class="text-red-600">Price book not found or already deleted</div>'
                    };
                }
            } catch (error) {
                console.error('❌ Delete error:', error);
                await client.end();
                return {
                    statusCode: 400,
                    headers,
                    body: `<div class="text-red-600">Error deleting price book: ${error.message}</div>`
                };
            }
        }

        // Main listing request
        console.log('📋 Price book listing request');

        const [tableTemplate, rowTemplate] = await Promise.all([
            getTemplate('price-book-table.html'),
            getTemplate('price-book-row.html')
        ]);

        // Parse filters
        let filters = event.queryStringParameters || {};

        if (event.httpMethod === 'POST' && event.body) {
            try {
                const formData = new URLSearchParams(event.body);
                for (const [key, value] of formData) {
                    if (value && value.trim()) {
                        filters[key] = value.trim();
                    }
                }
            } catch (e) {
                console.warn('Failed to parse form data:', e);
            }
        }

        // Pagination
        const page = parseInt(filters.page || '1');
        const limit = 15;
        const offset = (page - 1) * limit;

        // Build query
        const filterQuery = buildFilterQuery(filters);

        console.log('Applied filters:', filters);
        console.log('Filter query:', filterQuery.whereClause);

        // Get total count
        const countQuery = `
            SELECT COUNT(*) as total
            FROM application.prism_price_configuration
            WHERE ${filterQuery.whereClause}
        `;

        const countResult = await client.query(countQuery, filterQuery.params);
        const totalConfigs = parseInt(countResult.rows[0].total);

        // Get configurations
        const configsQuery = `
            SELECT
                id, config_id, version, name, description, config_type, pbm_code,
                additional_parameters, is_active,
                TO_CHAR(effective_from, 'MM/DD/YYYY') as effective_from_formatted,
                TO_CHAR(effective_to, 'MM/DD/YYYY') as effective_to_formatted,
                TO_CHAR(updated_at, 'MM/DD/YYYY HH24:MI') as updated_at_formatted
            FROM application.prism_price_configuration
            WHERE ${filterQuery.whereClause}
            ORDER BY updated_at DESC
            LIMIT $${filterQuery.params.length + 1} OFFSET $${filterQuery.params.length + 2}
        `;

        const queryParams = [...filterQuery.params, limit, offset];
        const result = await client.query(configsQuery, queryParams);

        await client.end();

        // Generate rows
        const configsHTML = result.rows.map((config, index) => {
            const rowData = {
                ROW_CLASS: index % 2 === 0 ? 'bg-white' : 'bg-gray-50',
                CONFIG_ID: config.config_id,
                NAME: config.name,
                VERSION: config.version,
                PBM_CODE: config.pbm_code,
                CONFIG_TYPE: config.config_type,
                CONFIG_TYPE_BADGE: config.config_type === 'PRODUCTION'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-purple-100 text-purple-800',
                EFFECTIVE_FROM: config.effective_from_formatted,
                EFFECTIVE_TO: config.effective_to_formatted,
                UPDATED_AT: config.updated_at_formatted,
                IS_ACTIVE: config.is_active
            };

            return renderTemplate(rowTemplate, rowData);
        }).join('');

        // Pagination
        const totalPages = Math.ceil(totalConfigs / limit);
        const startRecord = totalConfigs > 0 ? offset + 1 : 0;
        const endRecord = totalConfigs > 0 ? Math.min(offset + result.rows.length, totalConfigs) : 0;

        const paginationButtons = generatePaginationButtons(page, totalPages, filters);

        // Render final table
        const finalHTML = renderTemplate(tableTemplate, {
            CONFIG_ROWS: configsHTML,
            START_RECORD: startRecord,
            END_RECORD: endRecord,
            TOTAL_CONFIGS: totalConfigs,
            PAGINATION_BUTTONS: paginationButtons
        });

        return {
            statusCode: 200,
            headers,
            body: finalHTML
        };

    } catch (error) {
        console.error('❌ Lambda error:', error);

        try {
            await client.end();
        } catch (e) {
            console.error('Error closing client:', e);
        }

        return {
            statusCode: 500,
            headers,
            body: `<div class="text-red-500 p-4">
                <h3 class="font-bold">Error occurred:</h3>
                <p>${error.message}</p>
            </div>`
        };
    }
};

// Generate pagination buttons
function generatePaginationButtons(currentPage, totalPages, filters) {
    if (totalPages <= 1) return '';

    const filterParams = new URLSearchParams();
    Object.keys(filters).forEach(key => {
        if (filters[key] && key !== 'page') {
            filterParams.append(key, filters[key]);
        }
    });
    const baseQuery = filterParams.toString();

    let buttons = '';

    if (currentPage > 1) {
        const prevQuery = baseQuery ? `${baseQuery}&page=${currentPage - 1}` : `page=${currentPage - 1}`;
        buttons += `<button hx-get="https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/price-book?${prevQuery}" hx-target="#price-book-container" class="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50">Previous</button>`;
    }

    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, startPage + 4);

    for (let i = startPage; i <= endPage; i++) {
        const isActive = i === currentPage;
        const bgClass = isActive ? 'text-blue-600 bg-blue-50 border-blue-500' : 'text-gray-500 bg-white border-gray-300 hover:bg-gray-50';
        const pageQuery = baseQuery ? `${baseQuery}&page=${i}` : `page=${i}`;
        buttons += `<button hx-get="https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/price-book?${pageQuery}" hx-target="#price-book-container" class="px-3 py-2 text-sm font-medium ${bgClass} border rounded-md">${i}</button>`;
    }

    if (currentPage < totalPages) {
        const nextQuery = baseQuery ? `${baseQuery}&page=${currentPage + 1}` : `page=${currentPage + 1}`;
        buttons += `<button hx-get="https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/price-book?${nextQuery}" hx-target="#price-book-container" class="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50">Next</button>`;
    }

    return buttons;
}

exports.handler = handler;
