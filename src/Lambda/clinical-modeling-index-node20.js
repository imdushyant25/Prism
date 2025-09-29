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

// Generate criteria summary for display
function generateCriteriaSummary(criteria) {
    if (!criteria || criteria.length === 0) return 'No criteria defined';

    const summary = criteria.map(criterion => {
        const operatorText = {
            'starts_with': 'starts with',
            'equals': 'equals',
            'in': 'in',
            'contains': 'contains'
        }[criterion.operator] || criterion.operator;

        return `${criterion.field_name} ${operatorText} ${criterion.criteria_value}`;
    });

    return summary.join('<br>• ');
}

// Get clinical models from database
async function getClinicalModels(client) {
    try {
        const modelsQuery = `
            SELECT
                cm.*,
                COALESCE(cm.record_count, 0) as record_count,
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
            GROUP BY cm.model_id, cm.model_name, cm.description, cm.created_by,
                     cm.created_at, cm.updated_at, cm.is_active, cm.record_count
            ORDER BY cm.created_at DESC
        `;

        console.log('Executing clinical models query:', modelsQuery);

        const result = await client.query(modelsQuery);
        return result.rows;

    } catch (error) {
        console.error('Failed to get clinical models:', error);
        throw error;
    }
}

// Generate clinical models table HTML
async function generateClinicalModelsHTML(client, models) {
    try {
        console.log('🔍 generateClinicalModelsHTML called with', models.length, 'models');

        if (models.length === 0) {
            console.log('🔍 No models found, returning empty state HTML');
            return `
                <div class="bg-white rounded-lg border p-8">
                    <div class="text-center text-gray-500">
                        <svg class="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path>
                        </svg>
                        <h3 class="text-lg font-medium text-gray-900 mb-2">No Clinical Models Found</h3>
                        <p class="text-gray-500">Create your first clinical model to get started</p>
                        <button onclick="openAddClinicalModelModal()" class="mt-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium">
                            Add New Model
                        </button>
                    </div>
                </div>
            `;
        }

        console.log('🔍 Models found, attempting to load S3 template...');
        const tableTemplate = await getTemplate('clinical-models-table.html');
        console.log('✅ S3 template loaded successfully');

        // Load the row template
        const rowTemplate = await getTemplate('clinical-models-row.html');

        // Generate table rows using template
        const tableRows = models.map(model => {
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
                RECORD_COUNT: model.record_count || 0,
                IS_ACTIVE: model.is_active
            };

            return renderTemplate(rowTemplate, rowData);
        }).join('');

        const tableData = {
            TABLE_ROWS: tableRows,
            TOTAL_COUNT: models.length,
            START_RANGE: models.length > 0 ? 1 : 0,
            END_RANGE: models.length
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
                        criteria.push({
                            field_name: fieldName,
                            operator: operator,
                            criteria_value: criteriaValue,
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
                        headers,
                        body: '<div class="text-green-600">Clinical model deleted successfully!</div>'
                    };
                } else {
                    throw new Error('Model not found or already deleted');
                }
            } catch (error) {
                return {
                    statusCode: 400,
                    headers,
                    body: `<div class="text-red-600">Error deleting model: ${error.message}</div>`
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
                        headers,
                        body: '<div class="text-green-600">Clinical model activated successfully!</div>'
                    };
                } else {
                    throw new Error('Model not found or already active');
                }
            } catch (error) {
                return {
                    statusCode: 400,
                    headers,
                    body: `<div class="text-red-600">Error activating model: ${error.message}</div>`
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

            const models = await getClinicalModels(client);
            console.log('🔍 Got models from database, count:', models.length);

            console.log('🔍 Attempting to generate HTML...');
            const modelsHTML = await generateClinicalModelsHTML(client, models);
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