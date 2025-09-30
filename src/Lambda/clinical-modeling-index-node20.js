const AWS = require('aws-sdk');
const { Client } = require('pg');

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

    // Handle simple variable replacements {{KEY}}
    template = template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        const value = data[key];
        return value !== undefined && value !== null ? String(value) : '';
    });

    return template;
}

// Format criteria value as proper SQL expression
function formatCriteriaValue(operator, value) {
    if (!value) return value;

    // Clean the value
    const cleanValue = value.trim();

    switch (operator.toUpperCase()) {
        case 'IN':
        case 'NOT IN':
            // Handle comma-separated values for IN/NOT IN
            if (cleanValue.startsWith('(') && cleanValue.endsWith(')')) {
                // Already formatted as (val1, val2, val3)
                return cleanValue;
            } else {
                // Split by comma and format as ('val1', 'val2', 'val3')
                const values = cleanValue.split(',').map(v => `'${v.trim()}'`).join(', ');
                return `(${values})`;
            }
        case 'LIKE':
        case 'NOT LIKE':
            // Ensure LIKE values have wildcards and are quoted
            if (!cleanValue.includes('%') && !cleanValue.includes('_')) {
                return `'%${cleanValue}%'`;  // Add wildcards for partial matching
            } else {
                return `'${cleanValue}'`;     // User provided wildcards
            }
        case '=':
        case '!=':
        default:
            // For exact matches, add single quotes if not already present
            if (cleanValue.startsWith("'") && cleanValue.endsWith("'")) {
                return cleanValue;  // Already quoted
            } else {
                return `'${cleanValue}'`;  // Add quotes
            }
    }
}

// Generate criteria summary for display (Primary + Count approach)
function generateCriteriaSummary(criteria) {
    if (!criteria || criteria.length === 0) return 'No criteria defined';

    // Group criteria by data source (pbm + source_type + formulary_name)
    const dataSourcesMap = {};
    criteria.forEach(criterion => {
        const key = `${criterion.pbm}|${criterion.source_type}|${criterion.formulary_name}`;
        if (!dataSourcesMap[key]) {
            dataSourcesMap[key] = {
                pbm: criterion.pbm,
                source_type: criterion.source_type,
                formulary_name: criterion.formulary_name,
                criteria: []
            };
        }
        dataSourcesMap[key].criteria.push(criterion);
    });

    const dataSources = Object.values(dataSourcesMap);
    const totalCriteria = criteria.length;

    if (dataSources.length === 0) return 'No criteria defined';

    // Get primary data source (first one)
    const primarySource = dataSources[0];
    const primaryDisplay = `${primarySource.pbm} ${primarySource.source_type}`;

    if (dataSources.length === 1) {
        // Single source: "CVS Formulary • 3 criteria"
        return `${primaryDisplay} • ${totalCriteria} criteria`;
    } else {
        // Multiple sources: "CVS Formulary + 2 more • 8 criteria"
        const additionalCount = dataSources.length - 1;
        return `${primaryDisplay} + ${additionalCount} more • ${totalCriteria} criteria`;
    }
}

// Get clinical models from database
async function getClinicalModels(client, filters = {}) {
    try {
        let whereConditions = [];
        let queryParams = [];
        let paramIndex = 1;

        // Status filter
        if (filters.status === 'active') {
            whereConditions.push(`cm.is_active = $${paramIndex}`);
            queryParams.push(true);
            paramIndex++;
        } else if (filters.status === 'inactive') {
            whereConditions.push(`cm.is_active = $${paramIndex}`);
            queryParams.push(false);
            paramIndex++;
        }

        // PBM filter (check in criteria since models can have multiple PBMs)
        if (filters.pbm) {
            whereConditions.push(`EXISTS (
                SELECT 1 FROM application.prism_model_criteria mc2
                WHERE mc2.model_id = cm.model_id AND mc2.pbm = $${paramIndex}
            )`);
            queryParams.push(filters.pbm);
            paramIndex++;
        }

        // List type filter (check in criteria)
        if (filters.list_type) {
            whereConditions.push(`EXISTS (
                SELECT 1 FROM application.prism_model_criteria mc3
                WHERE mc3.model_id = cm.model_id AND mc3.source_type = $${paramIndex}
            )`);
            queryParams.push(filters.list_type);
            paramIndex++;
        }

        // Name search filter
        if (filters.name_search) {
            whereConditions.push(`(cm.model_name ILIKE $${paramIndex} OR cm.description ILIKE $${paramIndex})`);
            queryParams.push(`%${filters.name_search}%`);
            paramIndex++;
        }

        // Build WHERE clause
        const whereClause = whereConditions.length > 0 ?
            `WHERE ${whereConditions.join(' AND ')}` : '';

        const modelsQuery = `
            SELECT
                cm.*,
                -- Get criteria for each model
                COALESCE(
                    json_agg(
                        json_build_object(
                            'field_name', mc.field_name,
                            'operator', mc.operator,
                            'criteria_value', mc.criteria_value,
                            'source_type', mc.source_type,
                            'pbm', mc.pbm,
                            'formulary_name', mc.formulary_name
                        ) ORDER BY mc.created_at
                    ) FILTER (WHERE mc.criteria_id IS NOT NULL),
                    '[]'::json
                ) as criteria
            FROM application.prism_clinical_models cm
            LEFT JOIN application.prism_model_criteria mc ON cm.model_id = mc.model_id
            ${whereClause}
            GROUP BY cm.model_id, cm.model_name, cm.description, cm.created_by,
                     cm.created_at, cm.updated_at, cm.is_active, cm.last_executed_at, cm.is_executed
            ORDER BY cm.created_at DESC
        `;

        console.log('Executing clinical models query with filters:', modelsQuery, queryParams);

        const result = await client.query(modelsQuery, queryParams);
        return result.rows;

    } catch (error) {
        console.error('Failed to get clinical models:', error);
        throw error;
    }
}

// Get filter options for dropdowns
async function getFilterOptions(client) {
    try {
        // Get PBM options from system config (level 1, active, type = pbm)
        const pbmQuery = `
            SELECT config_code, display_name
            FROM application.prism_system_config
            WHERE config_level = 1
              AND config_type = 'pbm'
              AND is_active = true
            ORDER BY display_order, config_code
        `;

        // Get all List Type options from system config (level 2, active)
        // This gets all list types across all PBMs for filtering
        const listTypeQuery = `
            SELECT DISTINCT config_code, display_name
            FROM application.prism_system_config
            WHERE config_level = 2
              AND is_active = true
            ORDER BY config_code
        `;

        const [pbmResult, listTypeResult] = await Promise.all([
            client.query(pbmQuery),
            client.query(listTypeQuery)
        ]);

        return {
            pbms: pbmResult.rows,
            listTypes: listTypeResult.rows
        };

    } catch (error) {
        console.error('Failed to get filter options:', error);
        return { pbms: [], listTypes: [] };
    }
}

// Generate clinical models table HTML
async function generateClinicalModelsHTML(client, models, filterOptions = null, currentFilters = {}) {
    try {
        console.log('🔍 generateClinicalModelsHTML called with', models.length, 'models');

        // Always load the table template to preserve filters
        console.log('🔍 Loading table template...');
        const tableTemplate = await getTemplate('clinical-models-table.html');
        console.log('✅ Table template loaded successfully');

        let tableRows = '';

        if (models.length === 0) {
            console.log('🔍 No models found, showing empty state in table');
            // Show empty state inside the table structure to preserve filters
            tableRows = `
                <tr>
                    <td colspan="4" class="px-6 py-16 text-center">
                        <div class="text-gray-500">
                            <svg class="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path>
                            </svg>
                            <h3 class="text-lg font-medium text-gray-900 mb-2">No Clinical Models Found</h3>
                            <p class="text-gray-600 mb-4">Try adjusting your filters or create a new clinical model.</p>
                            <button onclick="openAddClinicalModelModal()"
                                    class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium">
                                Add New Model
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        } else {
            console.log('🔍 Models found, generating table rows...');
            // Load the row template
            const rowTemplate = await getTemplate('clinical-models-row.html');

            // Generate table rows using template
            tableRows = models.map(model => {
            // Create status badge
            const statusBadge = model.is_active
                ? '<span class="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">Active</span>'
                : '<span class="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full">Inactive</span>';

            const createdDate = new Date(model.created_at).toLocaleDateString();
            const createdBy = model.created_by || '';
            const modelDescription = model.description || null;

            // Generate criteria summary
            const criteriaSummary = generateCriteriaSummary(model.criteria);

            // Render row template with data
            const rowData = {
                MODEL_ID: model.model_id,
                MODEL_NAME: model.model_name,
                STATUS_BADGE: statusBadge,
                CREATED_DATE: createdDate,
                CREATED_BY: createdBy,
                MODEL_DESCRIPTION: modelDescription,
                CRITERIA_SUMMARY: criteriaSummary,
                LAST_EXECUTED_AT: model.last_executed_at ? new Date(model.last_executed_at).toLocaleDateString() : null,
                IS_ACTIVE: model.is_active
            };

            return renderTemplate(rowTemplate, rowData);
        }).join('');
        }

        // Generate filter options HTML with selected values preserved
        let statusOptionsHTML = '';
        let pbmOptionsHTML = '';
        let listTypeOptionsHTML = '';

        // Generate status options
        const activeSelected = currentFilters.status === 'active' ? ' selected' : '';
        const inactiveSelected = currentFilters.status === 'inactive' ? ' selected' : '';
        statusOptionsHTML = `
            <option value="active"${activeSelected}>Active</option>
            <option value="inactive"${inactiveSelected}>Inactive</option>
        `;

        if (filterOptions) {
            pbmOptionsHTML = filterOptions.pbms.map(pbm => {
                const selected = currentFilters.pbm === pbm.config_code ? ' selected' : '';
                return `<option value="${pbm.config_code}"${selected}>${pbm.display_name || pbm.config_code}</option>`;
            }).join('');

            listTypeOptionsHTML = filterOptions.listTypes.map(listType => {
                const selected = currentFilters.list_type === listType.config_code ? ' selected' : '';
                return `<option value="${listType.config_code}"${selected}>${listType.display_name || listType.config_code}</option>`;
            }).join('');
        }

        const tableData = {
            TABLE_ROWS: tableRows,
            TOTAL_COUNT: models.length,
            START_RANGE: models.length > 0 ? 1 : 0,
            END_RANGE: models.length,
            STATUS_OPTIONS: statusOptionsHTML,
            PBM_OPTIONS: pbmOptionsHTML,
            LIST_TYPE_OPTIONS: listTypeOptionsHTML,
            // Current filter values for search input
            CURRENT_NAME_SEARCH: currentFilters.name_search || ''
        };

        return renderTemplate(tableTemplate, tableData);

    } catch (error) {
        console.error('Failed to generate clinical models table:', error);
        throw error;
    }
}

// Delete clinical model (set is_active to false)
async function deleteClinicalModel(client, modelId) {
    try {
        const deleteQuery = `
            UPDATE application.prism_clinical_models SET
                is_active = false,
                updated_at = CURRENT_TIMESTAMP
            WHERE model_id = $1 AND is_active = true
        `;

        const result = await client.query(deleteQuery, [modelId]);
        return result.rowCount > 0;

    } catch (error) {
        console.error('Failed to delete clinical model:', error);
        throw error;
    }
}

// Hard delete clinical model (completely remove from database)
async function hardDeleteClinicalModel(client, modelId) {
    try {
        // Delete the model - this will cascade delete criteria and lists due to foreign keys
        const deleteQuery = `
            DELETE FROM application.prism_clinical_models
            WHERE model_id = $1
        `;

        const result = await client.query(deleteQuery, [modelId]);
        return result.rowCount > 0;

    } catch (error) {
        console.error('Failed to hard delete clinical model:', error);
        throw error;
    }
}

// Delete individual criteria
async function deleteCriteria(client, criteriaId) {
    try {
        const deleteQuery = `
            DELETE FROM application.prism_model_criteria
            WHERE criteria_id = $1
        `;
        const result = await client.query(deleteQuery, [criteriaId]);
        return result.rowCount > 0;
    } catch (error) {
        console.error('Failed to delete criteria:', error);
        throw error;
    }
}

// Activate clinical model (set is_active to true)
async function activateClinicalModel(client, modelId) {
    try {
        const activateQuery = `
            UPDATE application.prism_clinical_models SET
                is_active = true,
                updated_at = CURRENT_TIMESTAMP
            WHERE model_id = $1 AND is_active = false
        `;

        const result = await client.query(activateQuery, [modelId]);
        return result.rowCount > 0;

    } catch (error) {
        console.error('Failed to activate clinical model:', error);
        throw error;
    }
}

// Deactivate clinical model (set is_active to false)
async function deactivateClinicalModel(client, modelId) {
    try {
        const deactivateQuery = `
            UPDATE application.prism_clinical_models SET
                is_active = false,
                updated_at = CURRENT_TIMESTAMP
            WHERE model_id = $1 AND is_active = true
        `;

        const result = await client.query(deactivateQuery, [modelId]);
        return result.rowCount > 0;

    } catch (error) {
        console.error('Failed to deactivate clinical model:', error);
        throw error;
    }
}

// Get system configuration data (PBM options)
async function getSystemConfig(client) {
    try {
        const configQuery = `
            SELECT config_type,
                json_agg(
                    json_build_object(
                        'code', config_code,
                        'name', display_name,
                        'is_default', is_default
                    ) ORDER BY display_order
                ) as options
            FROM application.prism_system_config
            WHERE config_type = 'pbm'
              AND is_active = true
            GROUP BY config_type
        `;

        const result = await client.query(configQuery);
        const configData = {};

        result.rows.forEach(row => {
            configData[row.config_type] = row.options;
        });

        return configData;

    } catch (error) {
        console.error('Failed to get system config:', error);
        throw error;
    }
}

// Generate PBM options HTML
function generatePBMOptions(pbmOptions) {
    if (!pbmOptions || pbmOptions.length === 0) {
        return '<option value="">No PBMs available</option>';
    }

    return pbmOptions.map(pbm =>
        `<option value="${pbm.code}">${pbm.name}</option>`
    ).join('');
}

// Get list types for a specific PBM
async function getListTypes(client, pbm) {
    try {
        const listTypesQuery = `
            SELECT config_code, display_name
            FROM application.prism_system_config
            WHERE config_level = 2
              AND parent_code = $1
              AND is_active = true
            ORDER BY display_order
        `;

        const result = await client.query(listTypesQuery, [pbm]);
        return result.rows;

    } catch (error) {
        console.error('Failed to get list types:', error);
        throw error;
    }
}

// Generate list type options HTML
function generateListTypeOptions(listTypes) {
    if (!listTypes || listTypes.length === 0) {
        return '<option value="">No list types available</option>';
    }

    const defaultOption = '<option value="">Select list type...</option>';
    const options = listTypes.map(listType =>
        `<option value="${listType.config_code}">${listType.display_name}</option>`
    ).join('');

    return defaultOption + options;
}

// Get specific lists for a list type (like individual formularies)
async function getSpecificLists(client, listType) {
    try {
        const specificListsQuery = `
            SELECT config_code, display_name
            FROM application.prism_system_config
            WHERE config_level = 3
              AND parent_code = $1
              AND is_active = true
            ORDER BY display_order
        `;

        const result = await client.query(specificListsQuery, [listType]);
        return result.rows;

    } catch (error) {
        console.error('Failed to get specific lists:', error);
        throw error;
    }
}

// Generate specific list options HTML
function generateSpecificListOptions(specificLists) {
    if (!specificLists || specificLists.length === 0) {
        return '<option value="">No specific lists available</option>';
    }

    const defaultOption = '<option value="">Select specific list...</option>';
    const options = specificLists.map(list =>
        `<option value="${list.config_code}">${list.display_name}</option>`
    ).join('');

    return defaultOption + options;
}

// Generate add clinical model modal HTML
async function generateAddModelHTML(client) {
    try {
        console.log('🔄 Starting generateAddModelHTML...');

        console.log('📄 Loading S3 template: clinical-model-add.html');
        const addTemplate = await getTemplate('clinical-model-add.html');
        console.log('✅ Template loaded, length:', addTemplate.length);

        console.log('⚙️ Getting system config for PBM options...');
        const systemConfig = await getSystemConfig(client);
        console.log('✅ System config loaded:', Object.keys(systemConfig));
        console.log('🔍 PBM data:', systemConfig.pbm);

        const pbmOptions = generatePBMOptions(systemConfig.pbm || []);
        console.log('✅ Generated PBM options HTML, length:', pbmOptions.length);
        console.log('🔍 PBM options HTML:', pbmOptions);

        const templateData = {
            PBM_OPTIONS: pbmOptions
        };
        console.log('📋 Template data prepared:', templateData);

        const renderedHTML = renderTemplate(addTemplate, templateData);
        console.log('✅ Template rendered successfully, final length:', renderedHTML.length);

        return renderedHTML;

    } catch (error) {
        console.error('💥 Failed to generate add model HTML:', error);
        console.error('💥 Error stack:', error.stack);
        throw error;
    }
}

// Generate configure model HTML
async function generateConfigureModelHTML(client, modelId) {
    try {
        console.log('🔄 Starting generateConfigureModelHTML for model ID:', modelId);

        // Get model details with criteria
        const modelQuery = `
            SELECT
                cm.*,
                -- Get criteria for each model grouped by data source
                COALESCE(
                    json_agg(
                        json_build_object(
                            'criteria_id', mc.criteria_id,
                            'field_name', mc.field_name,
                            'operator', mc.operator,
                            'criteria_value', mc.criteria_value,
                            'action', mc.action,
                            'source_type', mc.source_type,
                            'pbm', mc.pbm,
                            'formulary_name', mc.formulary_name
                        ) ORDER BY mc.created_at
                    ) FILTER (WHERE mc.criteria_id IS NOT NULL),
                    '[]'::json
                ) as criteria
            FROM application.prism_clinical_models cm
            LEFT JOIN application.prism_model_criteria mc ON cm.model_id = mc.model_id
            WHERE cm.model_id = $1
            GROUP BY cm.model_id, cm.model_name, cm.description, cm.created_by,
                     cm.created_at, cm.updated_at, cm.is_active, cm.last_executed_at, cm.is_executed
        `;

        console.log('🔍 Executing model query for ID:', modelId);
        const modelResult = await client.query(modelQuery, [modelId]);

        if (modelResult.rows.length === 0) {
            throw new Error(`Model with ID ${modelId} not found`);
        }

        const model = modelResult.rows[0];
        console.log('✅ Model loaded:', model.model_name);
        console.log('📋 Criteria count:', model.criteria.length);

        // Group criteria by data source (pbm + source_type + formulary_name)
        const dataSourcesMap = {};
        model.criteria.forEach(criterion => {
            const key = `${criterion.pbm}|${criterion.source_type}|${criterion.formulary_name}`;
            if (!dataSourcesMap[key]) {
                dataSourcesMap[key] = {
                    id: key.replace(/\|/g, '-').toLowerCase(),
                    pbm: criterion.pbm,
                    source_type: criterion.source_type,
                    formulary_name: criterion.formulary_name,
                    criteria: []
                };
            }
            dataSourcesMap[key].criteria.push(criterion);
        });

        console.log('📊 Data sources grouped:', Object.keys(dataSourcesMap).length);

        // Load templates
        const configureTemplate = await getTemplate('clinical-model-configure.html');
        const dataSourceTemplate = await getTemplate('clinical-model-data-source.html');

        // Generate data sources HTML
        let dataSourcesHTML = '';
        for (const [key, dataSource] of Object.entries(dataSourcesMap)) {
            // Generate criteria HTML for this data source
            let criteriaHTML = '';
            dataSource.criteria.forEach(criterion => {
                const actionClass = criterion.action === 'A' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
                const actionText = criterion.action === 'A' ? 'Add' : 'Remove';

                criteriaHTML += `
                    <div class="flex items-center justify-between bg-gray-50 px-3 py-2 rounded"
                         data-criteria-id="${criterion.criteria_id}"
                         data-field-name="${criterion.field_name}"
                         data-operator="${criterion.operator}"
                         data-value="${criterion.criteria_value}"
                         data-action="${criterion.action}">
                        <div class="flex items-center space-x-2 text-sm">
                            <span class="font-medium text-gray-700">${criterion.field_name.toUpperCase()}</span>
                            <span class="text-gray-500">${criterion.operator}</span>
                            <span class="font-medium text-gray-900">${criterion.criteria_value}</span>
                            <span class="px-2 py-1 text-xs rounded ${actionClass}">
                                ${actionText}
                            </span>
                        </div>
                        <div class="flex items-center space-x-1">
                            <button onclick="deleteCriteria('${criterion.criteria_id}')"
                                    class="text-red-600 hover:text-red-800 p-1" title="Delete">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                `;
            });

            // Process each data source
            const dataSourceData = {
                DATA_SOURCE_ID: dataSource.id,
                PBM: dataSource.pbm,
                SOURCE_TYPE: dataSource.source_type,
                FORMULARY_NAME: dataSource.formulary_name,
                CRITERIA_COUNT: dataSource.criteria.length,
                CRITERIA_HTML: criteriaHTML
            };

            dataSourcesHTML += renderTemplate(dataSourceTemplate, dataSourceData);
        }

        // Get system config for PBM options
        const systemConfig = await getSystemConfig(client);
        const pbmOptions = generatePBMOptions(systemConfig.pbm || []);

        // Get primary PBM from first data source
        const dataSourcesList = Object.values(dataSourcesMap);
        const primaryPBM = dataSourcesList.length > 0 ? dataSourcesList[0].pbm : '';

        // Prepare template data
        const templateData = {
            MODEL_ID: model.model_id,
            MODEL_NAME: model.model_name,
            MODEL_DESCRIPTION: model.description,
            IS_ACTIVE: model.is_active,
            LAST_EXECUTED_AT: model.last_executed_at ? new Date(model.last_executed_at).toLocaleDateString() : 'Never',
            CREATED_DATE: new Date(model.created_at).toLocaleDateString(),
            CREATED_BY: model.created_by,
            DATA_SOURCE_COUNT: Object.keys(dataSourcesMap).length,
            DATA_SOURCES_HTML: dataSourcesHTML,
            PBM_OPTIONS: pbmOptions,
            PRIMARY_PBM: primaryPBM
        };

        console.log('📋 Template data prepared for configure modal');
        const renderedHTML = renderTemplate(configureTemplate, templateData);
        console.log('✅ Configure template rendered successfully, length:', renderedHTML.length);

        return renderedHTML;

    } catch (error) {
        console.error('💥 Failed to generate configure model HTML:', error);
        console.error('💥 Error stack:', error.stack);
        throw error;
    }
}

// Main Lambda handler
const handler = async (event) => {
    console.log('🚀 Clinical Modeling Lambda Event:', JSON.stringify(event, null, 2));

    const client = new Client({
        host: process.env.DB_HOST || 'prismdb.cluster-cwhkw4c7ykcz.us-east-1.rds.amazonaws.com',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'prism',
        user: process.env.DB_USER || 'prism_admin',
        password: process.env.DB_PASSWORD || 'Prism2024!',
        ssl: { rejectUnauthorized: false }
    });

    const headers = {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
    };

    try {
        await client.connect();

        const method = event.httpMethod || event.requestContext?.http?.method || 'GET';
        const path = event.path || event.rawPath || event.resource || '/clinical-models';
        const queryParams = event.queryStringParameters || {};
        const headers = event.headers || {};

        console.log(`🔍 Debug - Method: ${method}, Path: "${path}", Resource: "${event.resource}"`);
        console.log(`🔍 Debug - Full event keys:`, Object.keys(event));
        console.log(`🔍 Debug - Headers:`, headers);
        console.log(`🔍 Query params:`, queryParams);

        // Handle CORS preflight requests
        if (method === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'text/html',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                },
                body: ''
            };
        }


        // Handle create model (POST request)
        if (method === 'POST' && queryParams.action === 'create') {
            console.log('🆕 Creating new clinical model...');
            try {
                // Parse form data from body
                let formData = {};
                if (event.body) {
                    const params = new URLSearchParams(event.body);
                    for (const [key, value] of params) {
                        formData[key] = value;
                    }
                }
                console.log('📋 Form data received:', formData);

                // Extract model information
                const modelName = formData.model_name;
                const description = formData.description || null;
                const pbm = formData.pbm;
                const listType = formData.list_type;
                const specificList = formData.specific_list || listType; // Use specific list if available, otherwise list type
                const isActive = true; // All new models are active by default

                if (!modelName || !pbm || !listType) {
                    throw new Error('Model name, PBM, and list type are required');
                }

                // Extract criteria
                const criteria = [];
                let criteriaIndex = 0;
                while (formData[`criteria[${criteriaIndex}][field_name]`]) {
                    const fieldName = formData[`criteria[${criteriaIndex}][field_name]`];
                    const operator = formData[`criteria[${criteriaIndex}][operator]`];
                    const criteriaValue = formData[`criteria[${criteriaIndex}][criteria_value]`];
                    const action = formData[`criteria[${criteriaIndex}][action]`];

                    if (fieldName && operator && criteriaValue) {
                        // Format the criteria value as proper SQL expression
                        const formattedValue = formatCriteriaValue(operator, criteriaValue);

                        criteria.push({
                            field_name: fieldName,
                            operator: operator,
                            criteria_value: formattedValue,
                            action: action || 'A'
                        });
                    }
                    criteriaIndex++;
                }

                console.log('📝 Extracted criteria:', criteria);

                // Insert model into database (only basic info)
                const insertModelQuery = `
                    INSERT INTO application.prism_clinical_models
                    (model_name, description, is_active, created_at, updated_at)
                    VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    RETURNING model_id
                `;

                const modelResult = await client.query(insertModelQuery, [
                    modelName, description, isActive
                ]);

                const modelId = modelResult.rows[0].model_id;
                console.log('✅ Model created with ID:', modelId);

                // Insert criteria (includes PBM and formulary info)
                for (const criterion of criteria) {
                    const insertCriteriaQuery = `
                        INSERT INTO application.prism_model_criteria
                        (model_id, source_type, pbm, formulary_name, field_name, operator, criteria_value, action, created_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
                    `;

                    await client.query(insertCriteriaQuery, [
                        modelId,
                        listType, // source_type (formulary, biosimilar, etc.)
                        pbm, // pbm (CVS, ESI, etc.)
                        specificList || listType, // formulary_name (specific formulary or list type)
                        criterion.field_name,
                        criterion.operator,
                        criterion.criteria_value,
                        criterion.action
                    ]);
                }

                console.log('✅ All criteria inserted for model:', modelId);

                // Return success message with redirect trigger
                const successMessage = `
                    <div class="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
                        <strong>Success!</strong> Clinical model "${modelName}" has been created successfully.
                    </div>
                    <script>
                        // Close modal and reload the clinical models list
                        setTimeout(() => {
                            const modal = document.getElementById('rule-modal');
                            if (modal) {
                                modal.classList.remove('show');
                                document.body.classList.remove('modal-open');
                                document.body.style.overflow = '';
                            }
                            // Trigger reload of clinical models
                            htmx.ajax('GET', 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/clinical-models', {
                                target: '#clinical-models-container',
                                swap: 'innerHTML'
                            });
                        }, 1500);
                    </script>
                `;

                return {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'text/html',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                    },
                    body: successMessage
                };

            } catch (error) {
                console.error('💥 Error creating clinical model:', error);
                return {
                    statusCode: 500,
                    headers: {
                        'Content-Type': 'text/html',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                    },
                    body: `<div class="text-red-600">Error creating model: ${error.message}</div>`
                };
            }
        }

        // Handle add data source to existing model (POST request)
        if (method === 'POST' && queryParams.action === 'add-source') {
            console.log('➕ Adding data source to existing model...');
            try {
                // Parse form data from body
                let formData = {};
                if (event.body) {
                    const params = new URLSearchParams(event.body);
                    for (const [key, value] of params) {
                        formData[key] = value;
                    }
                }
                console.log('📋 Add source form data received:', formData);

                // Extract model ID and new source information
                const modelId = formData.model_id;
                const pbm = formData.new_pbm;
                const listType = formData.new_list_type;
                const specificList = formData.new_specific_list || listType;

                if (!modelId || !pbm || !listType) {
                    throw new Error('Model ID, PBM, and list type are required');
                }

                // Extract new criteria
                const criteria = [];
                let criteriaIndex = 0;
                while (formData[`new_criteria[${criteriaIndex}][field_name]`]) {
                    const fieldName = formData[`new_criteria[${criteriaIndex}][field_name]`];
                    const operator = formData[`new_criteria[${criteriaIndex}][operator]`];
                    const criteriaValue = formData[`new_criteria[${criteriaIndex}][criteria_value]`];
                    const action = formData[`new_criteria[${criteriaIndex}][action]`];

                    if (fieldName && operator && criteriaValue) {
                        // Format the criteria value as proper SQL expression
                        const formattedValue = formatCriteriaValue(operator, criteriaValue);

                        criteria.push({
                            field_name: fieldName,
                            operator: operator,
                            criteria_value: formattedValue,
                            action: action || 'A'
                        });
                    }
                    criteriaIndex++;
                }

                console.log('📝 Extracted new criteria for model:', modelId, criteria);

                if (criteria.length === 0) {
                    throw new Error('At least one criteria is required');
                }

                // Insert new criteria into database
                for (const criterion of criteria) {
                    const insertCriteriaQuery = `
                        INSERT INTO application.prism_model_criteria
                        (model_id, source_type, pbm, formulary_name, field_name, operator, criteria_value, action, created_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
                    `;

                    await client.query(insertCriteriaQuery, [
                        modelId,
                        listType, // source_type
                        pbm, // pbm
                        specificList, // formulary_name
                        criterion.field_name,
                        criterion.operator,
                        criterion.criteria_value,
                        criterion.action
                    ]);
                }

                console.log('✅ All new criteria inserted for model:', modelId);

                // Return success message and reload configure modal
                const successMessage = `
                    <div class="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
                        <strong>Success!</strong> New data source added successfully.
                    </div>
                    <script>
                        setTimeout(() => {
                            // Reload the configure modal with updated data
                            htmx.ajax('GET', 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/clinical-models?component=configure&id=${formData.model_id}', {
                                target: '#modal-content',
                                swap: 'innerHTML'
                            });

                            // Set flag to refresh list view when modal closes
                            window.clinicalModelNeedsRefresh = true;
                        }, 1000);
                    </script>
                `;

                return {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'text/html',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                    },
                    body: successMessage
                };

            } catch (error) {
                console.error('💥 Error adding data source:', error);
                return {
                    statusCode: 500,
                    headers: {
                        'Content-Type': 'text/html',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                    },
                    body: `<div class="text-red-600">Error adding data source: ${error.message}</div>`
                };
            }
        }

        // Handle delete model (POST request)
        if (method === 'POST' && queryParams.action === 'delete') {
            const modelId = queryParams.id;
            console.log('🗑️ Deleting clinical model:', modelId);
            try {
                const success = await deleteClinicalModel(client, modelId);
                if (success) {
                    console.log('✅ Deleted model:', modelId);
                    return {
                        statusCode: 200,
                        headers: {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                            'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                        },
                        body: JSON.stringify({ success: true, message: 'Clinical model deleted successfully!' })
                    };
                } else {
                    throw new Error('Model not found or already deleted');
                }
            } catch (error) {
                return {
                    statusCode: 400,
                    headers: {
                        'Content-Type': 'text/html',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                    },
                    body: `<div class="text-red-600">Error deleting model: ${error.message}</div>`
                };
            }
        }

        // Handle delete criteria (POST request)
        if (method === 'POST' && queryParams.action === 'delete-criteria') {
            const criteriaId = queryParams.criteria_id;
            const isLastCriteria = queryParams.is_last === 'true';
            console.log('🗑️ Deleting criteria:', criteriaId, 'Is last:', isLastCriteria);

            try {
                if (isLastCriteria) {
                    // Get the model ID from the criteria before deleting
                    const modelQuery = `
                        SELECT DISTINCT pcm.model_id
                        FROM application.prism_model_criteria pmc
                        JOIN application.prism_clinical_models pcm ON pmc.model_id = pcm.model_id
                        WHERE pmc.criteria_id = $1
                    `;
                    const modelResult = await client.query(modelQuery, [criteriaId]);

                    if (modelResult.rows.length === 0) {
                        throw new Error('Model not found for criteria');
                    }

                    const modelId = modelResult.rows[0].model_id;
                    console.log('💥 Deleting entire model:', modelId, 'after deleting last criteria');

                    // Hard delete the model - this will cascade delete all criteria including this one
                    const modelDeleted = await hardDeleteClinicalModel(client, modelId);
                    if (modelDeleted) {
                        console.log('✅ Deleted model and all criteria:', modelId);
                        return {
                            statusCode: 200,
                            headers: {
                                'Content-Type': 'application/json',
                                'Access-Control-Allow-Origin': '*',
                                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                                'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                            },
                            body: JSON.stringify({ success: true, message: 'Clinical model deleted successfully!' })
                        };
                    } else {
                        throw new Error('Failed to delete model');
                    }
                } else {
                    // Normal criteria deletion
                    const success = await deleteCriteria(client, criteriaId);
                    if (success) {
                        console.log('✅ Deleted criteria:', criteriaId);
                        return {
                            statusCode: 200,
                            headers: {
                                'Content-Type': 'application/json',
                                'Access-Control-Allow-Origin': '*',
                                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                                'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                            },
                            body: JSON.stringify({ success: true, message: 'Criteria deleted successfully!' })
                        };
                    } else {
                        throw new Error('Criteria not found');
                    }
                }
            } catch (error) {
                return {
                    statusCode: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                    },
                    body: JSON.stringify({ success: false, message: `Error deleting criteria: ${error.message}` })
                };
            }
        }


        // Handle activate model
        if (method === 'POST' && queryParams.action === 'activate') {
            const modelId = queryParams.id;
            console.log('✅ Activating clinical model:', modelId);
            try {
                const success = await activateClinicalModel(client, modelId);
                if (success) {
                    console.log('✅ Activated model:', modelId);
                    return {
                        statusCode: 200,
                        headers: {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                            'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                        },
                        body: JSON.stringify({ success: true, message: 'Clinical model activated successfully!' })
                    };
                } else {
                    throw new Error('Model not found or already active');
                }
            } catch (error) {
                return {
                    statusCode: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                    },
                    body: JSON.stringify({ success: false, message: `Error activating model: ${error.message}` })
                };
            }
        }

        // Handle deactivate model
        if (method === 'POST' && queryParams.action === 'deactivate') {
            const modelId = queryParams.id;
            console.log('⏸️ Deactivating clinical model:', modelId);
            try {
                const success = await deactivateClinicalModel(client, modelId);
                if (success) {
                    console.log('✅ Deactivated model:', modelId);
                    return {
                        statusCode: 200,
                        headers,
                        body: '<div class="text-green-600">Clinical model deactivated successfully!</div>'
                    };
                } else {
                    throw new Error('Model not found or already inactive');
                }
            } catch (error) {
                return {
                    statusCode: 400,
                    headers,
                    body: `<div class="text-red-600">Error deactivating model: ${error.message}</div>`
                };
            }
        }

        // Handle GET requests
        if (method === 'GET') {
            // Handle component requests
            if (queryParams.component === 'add') {
                console.log('🆕 Loading add model modal...');
                try {
                    const addHTML = await generateAddModelHTML(client);
                    console.log('✅ Add modal HTML generated successfully, length:', addHTML.length);
                    return {
                        statusCode: 200,
                        headers: {
                            'Content-Type': 'text/html',
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                            'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                        },
                        body: addHTML
                    };
                } catch (error) {
                    console.error('💥 Error generating add modal HTML:', error);
                    return {
                        statusCode: 500,
                        headers: {
                            'Content-Type': 'text/html',
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                            'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                        },
                        body: `<div class="text-red-600">Error loading modal: ${error.message}</div>`
                    };
                }
            }

            // Handle configure model requests
            if (queryParams.component === 'configure' && queryParams.id) {
                console.log('⚙️ Loading configure model modal for ID:', queryParams.id);
                try {
                    const configureHTML = await generateConfigureModelHTML(client, queryParams.id);
                    console.log('✅ Configure modal HTML generated successfully, length:', configureHTML.length);
                    return {
                        statusCode: 200,
                        headers: {
                            'Content-Type': 'text/html',
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                            'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                        },
                        body: configureHTML
                    };
                } catch (error) {
                    console.error('💥 Error generating configure modal HTML:', error);
                    return {
                        statusCode: 500,
                        headers: {
                            'Content-Type': 'text/html',
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                            'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                        },
                        body: `<div class="text-red-600">Error loading configure model form: ${error.message}</div>`
                    };
                }
            }

            // Handle list-types component request
            if (queryParams.component === 'list-types' && queryParams.pbm) {
                console.log('📋 Loading list types for PBM:', queryParams.pbm);
                try {
                    const listTypes = await getListTypes(client, queryParams.pbm);
                    const listTypeOptions = generateListTypeOptions(listTypes);
                    console.log('✅ List type options generated, count:', listTypes.length);
                    return {
                        statusCode: 200,
                        headers: {
                            'Content-Type': 'text/html',
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                            'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                        },
                        body: listTypeOptions
                    };
                } catch (error) {
                    console.error('💥 Error loading list types:', error);
                    return {
                        statusCode: 500,
                        headers: {
                            'Content-Type': 'text/html',
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                            'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                        },
                        body: '<option value="">Error loading list types</option>'
                    };
                }
            }

            // Handle specific-lists component request
            if (queryParams.component === 'specific-lists' && queryParams.list_type) {
                console.log('📋 Loading specific lists for list type:', queryParams.list_type);
                try {
                    const specificLists = await getSpecificLists(client, queryParams.list_type);
                    const specificListOptions = generateSpecificListOptions(specificLists);
                    console.log('✅ Specific list options generated, count:', specificLists.length);
                    return {
                        statusCode: 200,
                        headers: {
                            'Content-Type': 'text/html',
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                            'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                        },
                        body: specificListOptions
                    };
                } catch (error) {
                    console.error('💥 Error loading specific lists:', error);
                    return {
                        statusCode: 500,
                        headers: {
                            'Content-Type': 'text/html',
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                            'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                        },
                        body: '<option value="">Error loading specific lists</option>'
                    };
                }
            }

            // Default: load clinical models list
            console.log('📊 Loading clinical models...');

            // Extract filter parameters from query string
            const filters = {
                status: queryParams.status || null,
                pbm: queryParams.pbm || null,
                list_type: queryParams.list_type || null,
                name_search: queryParams.name_search || null
            };

            console.log('🔍 Filters applied:', filters);

            // Get filter options for dropdowns
            const filterOptions = await getFilterOptions(client);

            const models = await getClinicalModels(client, filters);
            console.log('🔍 Got models from database, count:', models.length);

            console.log('🔍 Attempting to generate HTML...');
            const modelsHTML = await generateClinicalModelsHTML(client, models, filterOptions, filters);
            console.log('✅ HTML generated successfully, length:', modelsHTML.length);

            const response = {
                statusCode: 200,
                headers: {
                    'Content-Type': 'text/html',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
                },
                body: modelsHTML
            };
            console.log('🔍 Returning response with headers:', Object.keys(response.headers));
            return response;
        }

        // Default response for unhandled routes
        return {
            statusCode: 404,
            headers,
            body: '<div class="text-red-600">Route not found</div>'
        };

    } catch (error) {
        console.error('💥 Lambda error:', error);

        return {
            statusCode: 500,
            headers,
            body: `<div class="text-red-600">Error: ${error.message}</div>`
        };
    } finally {
        try {
            await client.end();
        } catch (error) {
            console.error('Error closing database connection:', error);
        }
    }
};



exports.handler = handler;