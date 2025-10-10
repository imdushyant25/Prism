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
    let result = template;
    let previousResult;
    let iterations = 0;
    const maxIterations = 10; // Prevent infinite loops

    // Process conditionals multiple times to handle nested blocks
    do {
        previousResult = result;

        // Handle conditional blocks {{#KEY}} content {{/KEY}}
        result = result.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (match, key, content) => {
            const value = data[key];
            return (value && value !== false && value !== 0 && value !== '' && value !== null && value !== undefined) ? content : '';
        });

        // Handle inverted conditional blocks {{^KEY}} content {{/KEY}}
        result = result.replace(/\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (match, key, content) => {
            const value = data[key];
            return (!value || value === false || value === 0 || value === '' || value === null || value === undefined) ? content : '';
        });

        iterations++;
    } while (result !== previousResult && iterations < maxIterations);

    // Handle simple variable substitution {{KEY}}
    result = result.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        const value = data[key];
        return value !== undefined && value !== null ? String(value) : '';
    });

    return result;
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

        // PBM options with "All" as default
        const pbmOptionsArray = ['<option value="" selected>All PBMs</option>'];
        pbmOptionsArray.push(...configResult.rows.map(row =>
            `<option value="${row.config_code}">${row.display_name}</option>`
        ));
        const pbmOptions = pbmOptionsArray.join('');

        // Config Type options (PRODUCTION/MODELING) with "All" as default
        const configTypeOptions = [
            '<option value="" selected>All Types</option>',
            '<option value="PRODUCTION">Production</option>',
            '<option value="MODELING">Modeling</option>'
        ].join('');

        // Status options with "All" as default
        const statusOptions = [
            '<option value="all" selected>All Status</option>',
            '<option value="active">Active</option>',
            '<option value="inactive">Inactive</option>'
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

// Get parameter display names from system config
async function getParameterLabels(client) {
    try {
        const query = `
            SELECT config_code, display_name, parent_code
            FROM application.prism_system_config
            WHERE config_type = 'price_parameters'
              AND is_active = true
        `;
        const result = await client.query(query);

        // Create maps:
        // 1. parameter labels (parent_code IS NULL) - config_code -> display_name
        // 2. value labels (parent_code IS NOT NULL) - config_code -> display_name
        const parameterLabels = {};
        const valueLabels = {};

        result.rows.forEach(row => {
            if (row.parent_code === null) {
                // This is a parameter (e.g., 'hospital_pricing')
                parameterLabels[row.config_code] = row.display_name;
            } else {
                // This is a value (e.g., 'yes' under 'hospital_pricing')
                valueLabels[row.config_code] = row.display_name;
            }
        });

        return { parameterLabels, valueLabels };
    } catch (error) {
        console.error('Error getting parameter labels:', error);
        return { parameterLabels: {}, valueLabels: {} };
    }
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

// Generate edit price book HTML with populated data
async function generateEditPriceBookHTML(client, configId) {
    try {
        const editTemplate = await getTemplate('price-book-edit-modal.html');

        // Get the configuration data
        const configQuery = `
            SELECT * FROM application.prism_price_configuration
            WHERE config_id = $1 AND is_active = true
            ORDER BY version DESC
            LIMIT 1
        `;
        const configResult = await client.query(configQuery, [configId]);

        if (configResult.rows.length === 0) {
            throw new Error('Price book configuration not found');
        }

        const config = configResult.rows[0];
        const pricingStructure = typeof config.pricing_structure === 'string'
            ? JSON.parse(config.pricing_structure)
            : config.pricing_structure;
        const additionalParameters = typeof config.additional_parameters === 'string'
            ? JSON.parse(config.additional_parameters)
            : config.additional_parameters;

        // Helper function to safely get nested values
        const getNestedValue = (obj, path) => {
            return path.split('.').reduce((current, key) =>
                current && current[key] !== undefined && current[key] !== null ? current[key] : '', obj);
        };

        // Generate config type options with selection
        const configTypeOptions = [
            `<option value="PRODUCTION" ${config.config_type === 'PRODUCTION' ? 'selected' : ''}>Production</option>`,
            `<option value="MODELING" ${config.config_type === 'MODELING' ? 'selected' : ''}>Modeling</option>`
        ].join('');

        // Get additional parameters for this PBM
        const parameters = await getAdditionalParameters(client, config.pbm_code);
        const { parameterLabels, valueLabels } = await getParameterLabels(client);

        // Generate additional parameter fields
        let additionalParamsHTML = '';
        if (parameters.length > 0) {
            additionalParamsHTML = parameters.map(param => {
                const currentValue = additionalParameters[param.parameter_code] || '';
                const paramLabel = param.parameter_name;

                const options = param.valid_values.map(val =>
                    `<option value="${val.code}" ${currentValue === val.code ? 'selected' : ''}>${val.label}</option>`
                ).join('');

                return `
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">${paramLabel}</label>
                        <select name="param_${param.parameter_code}" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                            <option value="">Select ${paramLabel}</option>
                            ${options}
                        </select>
                    </div>
                `;
            }).join('');
        } else {
            additionalParamsHTML = '<p class="text-sm text-gray-500">No additional parameters available for this PBM.</p>';
        }

        // Generate formulary, client_size, contract_duration fields
        const formularyOptions = await getSystemConfigOptions(client, 'formulary', config.formulary);
        const clientSizeOptions = await getSystemConfigOptions(client, 'client_size', config.client_size);
        const contractDurationOptions = await getSystemConfigOptions(client, 'contract_duration', config.contract_duration);

        const formularyField = formularyOptions ? `
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Formulary</label>
                <select name="formulary" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                    <option value="">Select Formulary</option>
                    ${formularyOptions}
                </select>
            </div>
        ` : '';

        const clientSizeField = clientSizeOptions ? `
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Client Size</label>
                <select name="client_size" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                    <option value="">Select Client Size</option>
                    ${clientSizeOptions}
                </select>
            </div>
        ` : '';

        const contractDurationField = contractDurationOptions ? `
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Contract Duration</label>
                <select name="contract_duration" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                    <option value="">Select Duration</option>
                    ${contractDurationOptions}
                </select>
            </div>
        ` : '';

        // Format dates for input fields (YYYY-MM-DD)
        const formatDateForInput = (dateStr) => {
            if (!dateStr) return '';
            const date = new Date(dateStr);
            return date.toISOString().split('T')[0];
        };

        const editData = {
            CONFIG_ID: config.config_id,
            NAME: config.name,
            DESCRIPTION: config.description || '',
            PBM_CODE: config.pbm_code,
            CONFIG_TYPE_OPTIONS: configTypeOptions,
            EFFECTIVE_FROM: formatDateForInput(config.effective_from),
            EFFECTIVE_TO: formatDateForInput(config.effective_to),
            FORMULARY_FIELD: formularyField,
            CLIENT_SIZE_FIELD: clientSizeField,
            CONTRACT_DURATION_FIELD: contractDurationField,
            ADDITIONAL_PARAMETERS_FIELDS: additionalParamsHTML,

            // Overall fees
            OVERALL_PEPM_REBATE_CREDIT: getNestedValue(pricingStructure, 'overall.pepm_rebate_credit'),
            OVERALL_PRICING_FEE: getNestedValue(pricingStructure, 'overall.pricing_fee'),
            OVERALL_INHOUSE_PHARMACY_FEE: getNestedValue(pricingStructure, 'overall.inhouse_pharmacy_fee'),

            // Retail
            RETAIL_BRAND_REBATE: getNestedValue(pricingStructure, 'retail.brand.rebate'),
            RETAIL_BRAND_DISCOUNT: getNestedValue(pricingStructure, 'retail.brand.discount'),
            RETAIL_BRAND_DISPENSING_FEE: getNestedValue(pricingStructure, 'retail.brand.dispensing_fee'),
            RETAIL_GENERIC_DISCOUNT: getNestedValue(pricingStructure, 'retail.generic.discount'),
            RETAIL_GENERIC_DISPENSING_FEE: getNestedValue(pricingStructure, 'retail.generic.dispensing_fee'),

            // Retail 90
            RETAIL_90_BRAND_REBATE: getNestedValue(pricingStructure, 'retail_90.brand.rebate'),
            RETAIL_90_BRAND_DISCOUNT: getNestedValue(pricingStructure, 'retail_90.brand.discount'),
            RETAIL_90_BRAND_DISPENSING_FEE: getNestedValue(pricingStructure, 'retail_90.brand.dispensing_fee'),
            RETAIL_90_GENERIC_DISCOUNT: getNestedValue(pricingStructure, 'retail_90.generic.discount'),
            RETAIL_90_GENERIC_DISPENSING_FEE: getNestedValue(pricingStructure, 'retail_90.generic.dispensing_fee'),

            // Mail
            MAIL_BRAND_REBATE: getNestedValue(pricingStructure, 'mail.brand.rebate'),
            MAIL_BRAND_DISCOUNT: getNestedValue(pricingStructure, 'mail.brand.discount'),
            MAIL_BRAND_DISPENSING_FEE: getNestedValue(pricingStructure, 'mail.brand.dispensing_fee'),
            MAIL_GENERIC_DISCOUNT: getNestedValue(pricingStructure, 'mail.generic.discount'),
            MAIL_GENERIC_DISPENSING_FEE: getNestedValue(pricingStructure, 'mail.generic.dispensing_fee'),

            // Specialty Mail
            SPECIALTY_MAIL_BRAND_REBATE: getNestedValue(pricingStructure, 'specialty_mail.brand.rebate'),
            SPECIALTY_MAIL_BRAND_DISCOUNT: getNestedValue(pricingStructure, 'specialty_mail.brand.discount'),
            SPECIALTY_MAIL_BRAND_DISPENSING_FEE: getNestedValue(pricingStructure, 'specialty_mail.brand.dispensing_fee'),
            SPECIALTY_MAIL_GENERIC_DISCOUNT: getNestedValue(pricingStructure, 'specialty_mail.generic.discount'),
            SPECIALTY_MAIL_GENERIC_DISPENSING_FEE: getNestedValue(pricingStructure, 'specialty_mail.generic.dispensing_fee'),

            // Blended Specialty
            LDD_BLENDED_SPECIALTY_REBATE: getNestedValue(pricingStructure, 'ldd_blended_specialty.rebate'),
            LDD_BLENDED_SPECIALTY_DISCOUNT: getNestedValue(pricingStructure, 'ldd_blended_specialty.discount'),
            LDD_BLENDED_SPECIALTY_DISPENSING_FEE: getNestedValue(pricingStructure, 'ldd_blended_specialty.dispensing_fee'),
            NON_LDD_BLENDED_SPECIALTY_REBATE: getNestedValue(pricingStructure, 'non_ldd_blended_specialty.rebate'),
            NON_LDD_BLENDED_SPECIALTY_DISCOUNT: getNestedValue(pricingStructure, 'non_ldd_blended_specialty.discount'),
            NON_LDD_BLENDED_SPECIALTY_DISPENSING_FEE: getNestedValue(pricingStructure, 'non_ldd_blended_specialty.dispensing_fee')
        };

        return renderTemplate(editTemplate, editData);

    } catch (error) {
        console.error('Failed to generate edit price book form:', error);
        throw error;
    }
}

// Helper function to get system config options with selection
async function getSystemConfigOptions(client, configType, selectedValue) {
    try {
        const query = `
            SELECT config_code, display_name
            FROM application.prism_system_config
            WHERE parent_code = $1 AND is_active = true
            ORDER BY display_order
        `;
        const result = await client.query(query, [configType]);

        if (result.rows.length === 0) return null;

        return result.rows.map(row =>
            `<option value="${row.config_code}" ${row.config_code === selectedValue ? 'selected' : ''}>${row.display_name}</option>`
        ).join('');
    } catch (error) {
        console.error(`Error getting ${configType} options:`, error);
        return null;
    }
}

// Create new price book configuration
async function createPriceBook(client, formData) {
    const dbClient = client;

    try {
        await dbClient.query('BEGIN');

        console.log('Creating new price book with data:', formData);

        // Build pricing structure from flat form fields (same approach as price modeling)
        const pricingStructure = {};

        // Overall fees & credits (always include all fields, even if null)
        pricingStructure.overall = {
            pepm_rebate_credit: formData.overall_pepm_rebate_credit ? parseFloat(formData.overall_pepm_rebate_credit) : null,
            pricing_fee: formData.overall_pricing_fee ? parseFloat(formData.overall_pricing_fee) : null,
            inhouse_pharmacy_fee: formData.overall_inhouse_pharmacy_fee ? parseFloat(formData.overall_inhouse_pharmacy_fee) : null
        };

        // Build category structures (retail, retail_90, mail, specialty_mail) - always include all fields
        const categories = ['retail', 'retail_90', 'mail', 'specialty_mail'];
        categories.forEach(category => {
            pricingStructure[category] = {
                brand: {
                    rebate: formData[`${category}_brand_rebate`] ? parseFloat(formData[`${category}_brand_rebate`]) : null,
                    discount: formData[`${category}_brand_discount`] ? parseFloat(formData[`${category}_brand_discount`]) : null,
                    dispensing_fee: formData[`${category}_brand_dispensing_fee`] ? parseFloat(formData[`${category}_brand_dispensing_fee`]) : null
                },
                generic: {
                    discount: formData[`${category}_generic_discount`] ? parseFloat(formData[`${category}_generic_discount`]) : null,
                    dispensing_fee: formData[`${category}_generic_dispensing_fee`] ? parseFloat(formData[`${category}_generic_dispensing_fee`]) : null
                }
            };
        });

        // Blended specialty categories - always include all fields
        ['ldd_blended_specialty', 'non_ldd_blended_specialty'].forEach(category => {
            pricingStructure[category] = {
                rebate: formData[`${category}_rebate`] ? parseFloat(formData[`${category}_rebate`]) : null,
                discount: formData[`${category}_discount`] ? parseFloat(formData[`${category}_discount`]) : null,
                dispensing_fee: formData[`${category}_dispensing_fee`] ? parseFloat(formData[`${category}_dispensing_fee`]) : null
            };
        });

        console.log('Built pricing_structure:', JSON.stringify(pricingStructure, null, 2));

        // Build additional parameters from param_* fields (include all, even empty)
        const additionalParameters = {};
        Object.keys(formData).forEach(key => {
            if (key.startsWith('param_')) {
                const paramCode = key.replace('param_', '');
                // Save the value even if empty (empty string becomes empty string, not null)
                additionalParameters[paramCode] = formData[key] || '';
            }
        });

        console.log('Built additional_parameters:', JSON.stringify(additionalParameters, null, 2));

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

        // Extract special fields (these go in dedicated columns, not JSONB)
        const formulary = formData.formulary || null;
        const clientSize = formData.client_size || null;
        const contractDuration = formData.contract_duration || null;

        // Insert new configuration
        const insertQuery = `
            INSERT INTO application.prism_price_configuration (
                config_id, version, name, description, config_type, pbm_code,
                formulary, client_size, contract_duration,
                pricing_structure, additional_parameters, effective_from, effective_to,
                is_active, created_by
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
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
            formulary,
            clientSize,
            contractDuration,
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

        // Build pricing structure from flat form fields (same approach as create - always include all fields)
        const pricingStructure = {};

        // Overall fees & credits (always include all fields, even if null)
        pricingStructure.overall = {
            pepm_rebate_credit: formData.overall_pepm_rebate_credit ? parseFloat(formData.overall_pepm_rebate_credit) : null,
            pricing_fee: formData.overall_pricing_fee ? parseFloat(formData.overall_pricing_fee) : null,
            inhouse_pharmacy_fee: formData.overall_inhouse_pharmacy_fee ? parseFloat(formData.overall_inhouse_pharmacy_fee) : null
        };

        // Build category structures (retail, retail_90, mail, specialty_mail) - always include all fields
        const categories = ['retail', 'retail_90', 'mail', 'specialty_mail'];
        categories.forEach(category => {
            pricingStructure[category] = {
                brand: {
                    rebate: formData[`${category}_brand_rebate`] ? parseFloat(formData[`${category}_brand_rebate`]) : null,
                    discount: formData[`${category}_brand_discount`] ? parseFloat(formData[`${category}_brand_discount`]) : null,
                    dispensing_fee: formData[`${category}_brand_dispensing_fee`] ? parseFloat(formData[`${category}_brand_dispensing_fee`]) : null
                },
                generic: {
                    discount: formData[`${category}_generic_discount`] ? parseFloat(formData[`${category}_generic_discount`]) : null,
                    dispensing_fee: formData[`${category}_generic_dispensing_fee`] ? parseFloat(formData[`${category}_generic_dispensing_fee`]) : null
                }
            };
        });

        // Blended specialty categories - always include all fields
        ['ldd_blended_specialty', 'non_ldd_blended_specialty'].forEach(category => {
            pricingStructure[category] = {
                rebate: formData[`${category}_rebate`] ? parseFloat(formData[`${category}_rebate`]) : null,
                discount: formData[`${category}_discount`] ? parseFloat(formData[`${category}_discount`]) : null,
                dispensing_fee: formData[`${category}_dispensing_fee`] ? parseFloat(formData[`${category}_dispensing_fee`]) : null
            };
        });

        // Build additional parameters from param_* fields (include all, even empty)
        const additionalParameters = {};
        Object.keys(formData).forEach(key => {
            if (key.startsWith('param_')) {
                const paramCode = key.replace('param_', '');
                // Save the value even if empty (empty string becomes empty string, not null)
                additionalParameters[paramCode] = formData[key] || '';
            }
        });

        // Deactivate current version
        await dbClient.query(
            'UPDATE application.prism_price_configuration SET is_active = false WHERE config_id = $1 AND is_active = true',
            [configId]
        );

        // Extract special fields (these go in dedicated columns, not JSONB)
        const formulary = formData.formulary || currentConfig.formulary || null;
        const clientSize = formData.client_size || currentConfig.client_size || null;
        const contractDuration = formData.contract_duration || currentConfig.contract_duration || null;

        // Insert new version
        const insertQuery = `
            INSERT INTO application.prism_price_configuration (
                config_id, version, name, description, config_type, pbm_code,
                formulary, client_size, contract_duration,
                pricing_structure, additional_parameters, effective_from, effective_to,
                is_active, created_by, last_modified_by
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
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
            formulary,
            clientSize,
            contractDuration,
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

// Delete price book (set is_active to false and favorite to false)
async function deletePriceBook(client, configId) {
    try {
        const deleteQuery = `
            UPDATE application.prism_price_configuration
            SET is_active = false, favorite = false, updated_at = CURRENT_TIMESTAMP
            WHERE config_id = $1 AND is_active = true
        `;

        const result = await client.query(deleteQuery, [configId]);
        return result.rowCount > 0;

    } catch (error) {
        console.error('Failed to delete price book:', error);
        throw error;
    }
}

// Make price book active (restore inactive/deleted configuration)
async function makeActivePriceBook(client, configId) {
    try {
        const activateQuery = `
            UPDATE application.prism_price_configuration
            SET is_active = true, updated_at = CURRENT_TIMESTAMP
            WHERE config_id = $1 AND is_active = false
        `;

        const result = await client.query(activateQuery, [configId]);
        return result.rowCount > 0;

    } catch (error) {
        console.error('Failed to make price book active:', error);
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

        // Handle add modal request
        if (method === 'GET' && event.queryStringParameters?.component === 'add') {
            console.log('➕ Add modal request');
            const addModalTemplate = await getTemplate('price-book-add-modal.html');

            // Get PBM options
            const configQuery = `
                SELECT config_code, display_name
                FROM application.prism_system_config
                WHERE config_type = 'pbm' AND is_active = true
                ORDER BY display_order
            `;
            const configResult = await client.query(configQuery);
            const pbmOptions = configResult.rows
                .map(row => `<option value="${row.config_code}">${row.display_name}</option>`)
                .join('');

            await client.end();

            const modalHTML = renderTemplate(addModalTemplate, {
                PBM_OPTIONS: pbmOptions
            });

            return {
                statusCode: 200,
                headers,
                body: modalHTML
            };
        }

        // Handle edit modal request
        if (method === 'GET' && event.queryStringParameters?.component === 'edit') {
            console.log('✏️ Edit modal request');
            const configId = event.queryStringParameters.id;

            if (!configId) {
                return {
                    statusCode: 400,
                    headers,
                    body: '<div class="text-red-600">Config ID required for editing</div>'
                };
            }

            try {
                const editHTML = await generateEditPriceBookHTML(client, configId);
                await client.end();

                return {
                    statusCode: 200,
                    headers,
                    body: editHTML
                };
            } catch (error) {
                console.error('❌ Edit modal error:', error);
                await client.end();
                return {
                    statusCode: 400,
                    headers,
                    body: `<div class="text-red-600">Error loading edit form: ${error.message}</div>`
                };
            }
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
                    body: ''
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
        if (method === 'POST' && event.queryStringParameters?.action === 'update') {
            console.log('💾 Update price book request');
            const configId = event.queryStringParameters?.id;

            if (!configId) {
                return {
                    statusCode: 400,
                    headers,
                    body: '<div class="text-red-600">Config ID required for update</div>'
                };
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

            try {
                const result = await updatePriceBook(client, configId, formData);
                await client.end();

                if (result.success) {
                    return {
                        statusCode: 200,
                        headers: { ...headers, 'HX-Trigger': 'priceBookUpdated' },
                        body: ''  // Empty body, just trigger event
                    };
                } else {
                    return {
                        statusCode: 400,
                        headers,
                        body: `<div class="text-red-600">Failed to update price book: ${result.error}</div>`
                    };
                }
            } catch (error) {
                console.error('❌ Update error:', error);
                await client.end();
                return {
                    statusCode: 400,
                    headers,
                    body: `<div class="text-red-600">Error updating price book: ${error.message}</div>`
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

        // Handle toggle favorite request
        if (method === 'POST' && event.queryStringParameters?.action === 'toggle_favorite') {
            console.log('⭐ Toggle favorite request');
            const configId = event.queryStringParameters?.id;

            if (!configId) {
                return {
                    statusCode: 400,
                    headers,
                    body: '<div class="text-red-600">Config ID required</div>'
                };
            }

            try {
                // Get current favorite status
                const getQuery = `
                    SELECT favorite FROM application.prism_price_configuration
                    WHERE config_id = $1 AND is_active = true
                    LIMIT 1
                `;
                const getResult = await client.query(getQuery, [configId]);

                if (getResult.rows.length === 0) {
                    await client.end();
                    return {
                        statusCode: 400,
                        headers,
                        body: '<div class="text-red-600">Price book not found</div>'
                    };
                }

                const currentFavorite = getResult.rows[0].favorite;
                const newFavorite = !currentFavorite;

                // Toggle favorite status
                const updateQuery = `
                    UPDATE application.prism_price_configuration
                    SET favorite = $1, updated_at = CURRENT_TIMESTAMP
                    WHERE config_id = $2 AND is_active = true
                `;
                await client.query(updateQuery, [newFavorite, configId]);

                console.log(`✅ Toggled favorite for ${configId}: ${currentFavorite} -> ${newFavorite}`);
                await client.end();

                return {
                    statusCode: 200,
                    headers: { ...headers, 'HX-Trigger': 'priceBookUpdated' },
                    body: `<div class="text-green-600">${newFavorite ? 'Added to' : 'Removed from'} favorites!</div>`
                };
            } catch (error) {
                console.error('❌ Toggle favorite error:', error);
                await client.end();
                return {
                    statusCode: 400,
                    headers,
                    body: `<div class="text-red-600">Error updating favorite status: ${error.message}</div>`
                };
            }
        }

        // Handle make active request
        if (method === 'POST' && event.queryStringParameters?.action === 'makeActive') {
            console.log('✅ Make active price book request');
            const configId = event.queryStringParameters?.id;

            if (!configId) {
                return {
                    statusCode: 400,
                    headers,
                    body: '<div class="text-red-600">Config ID required</div>'
                };
            }

            try {
                const success = await makeActivePriceBook(client, configId);

                if (success) {
                    console.log('✅ Activated price book:', configId);
                    await client.end();
                    return {
                        statusCode: 200,
                        headers: { ...headers, 'HX-Trigger': 'priceBookUpdated' },
                        body: '<div class="text-green-600">Price book activated successfully!</div>'
                    };
                } else {
                    await client.end();
                    return {
                        statusCode: 400,
                        headers,
                        body: '<div class="text-red-600">Price book not found or already active</div>'
                    };
                }
            } catch (error) {
                console.error('❌ Make active error:', error);
                await client.end();
                return {
                    statusCode: 400,
                    headers,
                    body: `<div class="text-red-600">Error activating price book: ${error.message}</div>`
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
                formulary, client_size, contract_duration,
                pricing_structure, additional_parameters, is_active, favorite, draft,
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

        // Get parameter and value labels from system config
        const { parameterLabels, valueLabels } = await getParameterLabels(client);

        await client.end();

        // Generate rows
        const configsHTML = result.rows.map((config) => {
            // Build configuration display (non-null parameters)
            const configParts = [];

            // Add PBM
            if (config.pbm_code) {
                configParts.push(`<strong>PBM:</strong> ${config.pbm_code}`);
            }

            // Add formulary (use centralized labels)
            if (config.formulary) {
                const paramLabel = parameterLabels['formulary'] || 'Formulary';
                const valueDisplay = valueLabels[config.formulary] || config.formulary.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                configParts.push(`<strong>${paramLabel}:</strong> ${valueDisplay}`);
            }

            // Add client size (use centralized labels)
            if (config.client_size) {
                const paramLabel = parameterLabels['client_size'] || 'Client Size';
                const valueDisplay = valueLabels[config.client_size] || config.client_size.replace(/>/g, '> ').replace(/</g, '< ');
                configParts.push(`<strong>${paramLabel}:</strong> ${valueDisplay}`);
            }

            // Add contract duration (use centralized labels)
            if (config.contract_duration) {
                const paramLabel = parameterLabels['contract_duration'] || 'Contract Duration';
                const valueDisplay = valueLabels[config.contract_duration] || config.contract_duration.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                configParts.push(`<strong>${paramLabel}:</strong> ${valueDisplay}`);
            }

            // Add additional parameters (non-null only) - use centralized labels
            if (config.additional_parameters) {
                try {
                    const params = JSON.parse(config.additional_parameters);
                    Object.keys(params).forEach(key => {
                        if (params[key] && params[key] !== '') {
                            // Use parameter label from database, fallback to formatted key
                            const paramLabel = parameterLabels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                            // Use value label from database, fallback to formatted value
                            const valueDisplay = valueLabels[params[key]] || params[key].toString().replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                            configParts.push(`<strong>${paramLabel}:</strong> ${valueDisplay}`);
                        }
                    });
                } catch (e) {
                    console.error('Error parsing additional parameters:', e);
                }
            }

            const configurationDisplay = configParts.length > 0
                ? configParts.map(p => `• ${p}`).join('<br>')
                : '• No configuration specified';

            // Build price structure display (like price modeling)
            const priceStructureParts = [];
            if (config.pricing_structure) {
                try {
                    const pricing = typeof config.pricing_structure === 'string'
                        ? JSON.parse(config.pricing_structure)
                        : config.pricing_structure;

                    console.log('Pricing structure for', config.name, ':', JSON.stringify(pricing));

                    // Overall fees (check for non-null values)
                    if (pricing.overall) {
                        if (pricing.overall.pepm_rebate_credit !== null && pricing.overall.pepm_rebate_credit !== undefined) {
                            priceStructureParts.push(`<strong>PEPM Rebate Credit:</strong> $${pricing.overall.pepm_rebate_credit}`);
                        }
                        if (pricing.overall.pricing_fee !== null && pricing.overall.pricing_fee !== undefined) {
                            priceStructureParts.push(`<strong>Pricing Fee:</strong> $${pricing.overall.pricing_fee}`);
                        }
                        if (pricing.overall.inhouse_pharmacy_fee !== null && pricing.overall.inhouse_pharmacy_fee !== undefined) {
                            priceStructureParts.push(`<strong>In-House Pharmacy Fee:</strong> $${pricing.overall.inhouse_pharmacy_fee}`);
                        }
                    }

                    // Retail pricing
                    if (pricing.retail) {
                        const retailParts = [];
                        if (pricing.retail.brand?.rebate !== null && pricing.retail.brand?.rebate !== undefined) {
                            retailParts.push(`Brand Rebate: $${pricing.retail.brand.rebate}`);
                        }
                        if (pricing.retail.brand?.discount !== null && pricing.retail.brand?.discount !== undefined) {
                            retailParts.push(`Brand Discount: ${pricing.retail.brand.discount}%`);
                        }
                        if (pricing.retail.brand?.dispensing_fee !== null && pricing.retail.brand?.dispensing_fee !== undefined) {
                            retailParts.push(`Brand Disp Fee: $${pricing.retail.brand.dispensing_fee}`);
                        }
                        if (pricing.retail.generic?.discount !== null && pricing.retail.generic?.discount !== undefined) {
                            retailParts.push(`Generic Discount: ${pricing.retail.generic.discount}%`);
                        }
                        if (pricing.retail.generic?.dispensing_fee !== null && pricing.retail.generic?.dispensing_fee !== undefined) {
                            retailParts.push(`Generic Disp Fee: $${pricing.retail.generic.dispensing_fee}`);
                        }
                        if (retailParts.length > 0) {
                            priceStructureParts.push(`<strong>Retail:</strong> ${retailParts.join(', ')}`);
                        }
                    }

                    // Retail 90
                    if (pricing.retail_90) {
                        const retail90Parts = [];
                        if (pricing.retail_90.brand?.rebate !== null && pricing.retail_90.brand?.rebate !== undefined) {
                            retail90Parts.push(`Brand Rebate: $${pricing.retail_90.brand.rebate}`);
                        }
                        if (pricing.retail_90.brand?.discount !== null && pricing.retail_90.brand?.discount !== undefined) {
                            retail90Parts.push(`Brand Discount: ${pricing.retail_90.brand.discount}%`);
                        }
                        if (pricing.retail_90.brand?.dispensing_fee !== null && pricing.retail_90.brand?.dispensing_fee !== undefined) {
                            retail90Parts.push(`Brand Disp Fee: $${pricing.retail_90.brand.dispensing_fee}`);
                        }
                        if (pricing.retail_90.generic?.discount !== null && pricing.retail_90.generic?.discount !== undefined) {
                            retail90Parts.push(`Generic Discount: ${pricing.retail_90.generic.discount}%`);
                        }
                        if (pricing.retail_90.generic?.dispensing_fee !== null && pricing.retail_90.generic?.dispensing_fee !== undefined) {
                            retail90Parts.push(`Generic Disp Fee: $${pricing.retail_90.generic.dispensing_fee}`);
                        }
                        if (retail90Parts.length > 0) {
                            priceStructureParts.push(`<strong>Retail 90:</strong> ${retail90Parts.join(', ')}`);
                        }
                    }

                    // Mail
                    if (pricing.mail) {
                        const mailParts = [];
                        if (pricing.mail.brand?.rebate !== null && pricing.mail.brand?.rebate !== undefined) {
                            mailParts.push(`Brand Rebate: $${pricing.mail.brand.rebate}`);
                        }
                        if (pricing.mail.brand?.discount !== null && pricing.mail.brand?.discount !== undefined) {
                            mailParts.push(`Brand Discount: ${pricing.mail.brand.discount}%`);
                        }
                        if (pricing.mail.brand?.dispensing_fee !== null && pricing.mail.brand?.dispensing_fee !== undefined) {
                            mailParts.push(`Brand Disp Fee: $${pricing.mail.brand.dispensing_fee}`);
                        }
                        if (pricing.mail.generic?.discount !== null && pricing.mail.generic?.discount !== undefined) {
                            mailParts.push(`Generic Discount: ${pricing.mail.generic.discount}%`);
                        }
                        if (pricing.mail.generic?.dispensing_fee !== null && pricing.mail.generic?.dispensing_fee !== undefined) {
                            mailParts.push(`Generic Disp Fee: $${pricing.mail.generic.dispensing_fee}`);
                        }
                        if (mailParts.length > 0) {
                            priceStructureParts.push(`<strong>Mail:</strong> ${mailParts.join(', ')}`);
                        }
                    }

                    // Specialty Mail
                    if (pricing.specialty_mail) {
                        const specialtyMailParts = [];
                        if (pricing.specialty_mail.brand?.rebate !== null && pricing.specialty_mail.brand?.rebate !== undefined) {
                            specialtyMailParts.push(`Brand Rebate: $${pricing.specialty_mail.brand.rebate}`);
                        }
                        if (pricing.specialty_mail.brand?.discount !== null && pricing.specialty_mail.brand?.discount !== undefined) {
                            specialtyMailParts.push(`Brand Discount: ${pricing.specialty_mail.brand.discount}%`);
                        }
                        if (pricing.specialty_mail.brand?.dispensing_fee !== null && pricing.specialty_mail.brand?.dispensing_fee !== undefined) {
                            specialtyMailParts.push(`Brand Disp Fee: $${pricing.specialty_mail.brand.dispensing_fee}`);
                        }
                        if (pricing.specialty_mail.generic?.discount !== null && pricing.specialty_mail.generic?.discount !== undefined) {
                            specialtyMailParts.push(`Generic Discount: ${pricing.specialty_mail.generic.discount}%`);
                        }
                        if (pricing.specialty_mail.generic?.dispensing_fee !== null && pricing.specialty_mail.generic?.dispensing_fee !== undefined) {
                            specialtyMailParts.push(`Generic Disp Fee: $${pricing.specialty_mail.generic.dispensing_fee}`);
                        }
                        if (specialtyMailParts.length > 0) {
                            priceStructureParts.push(`<strong>Specialty Mail:</strong> ${specialtyMailParts.join(', ')}`);
                        }
                    }

                    // Specialty pricing
                    if (pricing.ldd_blended_specialty) {
                        const lddParts = [];
                        if (pricing.ldd_blended_specialty.rebate !== null && pricing.ldd_blended_specialty.rebate !== undefined) {
                            lddParts.push(`Rebate: $${pricing.ldd_blended_specialty.rebate}`);
                        }
                        if (pricing.ldd_blended_specialty.discount !== null && pricing.ldd_blended_specialty.discount !== undefined) {
                            lddParts.push(`Discount: ${pricing.ldd_blended_specialty.discount}%`);
                        }
                        if (lddParts.length > 0) {
                            priceStructureParts.push(`<strong>LDD Blended Specialty:</strong> ${lddParts.join(', ')}`);
                        }
                    }

                    if (pricing.non_ldd_blended_specialty) {
                        const nonLddParts = [];
                        if (pricing.non_ldd_blended_specialty.rebate !== null && pricing.non_ldd_blended_specialty.rebate !== undefined) {
                            nonLddParts.push(`Rebate: $${pricing.non_ldd_blended_specialty.rebate}`);
                        }
                        if (pricing.non_ldd_blended_specialty.discount !== null && pricing.non_ldd_blended_specialty.discount !== undefined) {
                            nonLddParts.push(`Discount: ${pricing.non_ldd_blended_specialty.discount}%`);
                        }
                        if (nonLddParts.length > 0) {
                            priceStructureParts.push(`<strong>Non-LDD Blended Specialty:</strong> ${nonLddParts.join(', ')}`);
                        }
                    }
                } catch (e) {
                    console.error('Error parsing pricing structure for', config.name, ':', e);
                }
            }

            const priceStructureDisplay = priceStructureParts.length > 0
                ? priceStructureParts.map(p => `• ${p}`).join('<br>')
                : '• No pricing structure specified';

            const rowData = {
                CONFIG_ID: config.config_id,
                NAME: config.name,
                PBM_CODE: config.pbm_code,
                CONFIG_TYPE: config.config_type,
                CONFIG_TYPE_BADGE: config.config_type === 'PRODUCTION'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-purple-100 text-purple-800',
                CONFIGURATION_DISPLAY: configurationDisplay,
                PRICE_STRUCTURE_DISPLAY: priceStructureDisplay,
                EFFECTIVE_FROM: config.effective_from_formatted,
                EFFECTIVE_TO: config.effective_to_formatted,
                UPDATED_AT: config.updated_at_formatted,
                IS_ACTIVE: config.is_active,
                IS_PRODUCTION: config.config_type === 'PRODUCTION',
                IS_FAVORITE: config.favorite,
                // Combined flag: show favorite menu only for active production products
                SHOW_FAVORITE_MENU: config.is_active && config.config_type === 'PRODUCTION'
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
