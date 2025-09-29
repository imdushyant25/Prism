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
        const tableTemplate = await getTemplate('clinical-models-table.html');

        if (models.length === 0) {
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

// Generate add clinical model modal HTML
async function generateAddModelHTML(client) {
    try {
        const addTemplate = await getTemplate('clinical-model-add.html');

        // Get PBM options from system config
        const systemConfig = await getSystemConfig(client);
        const pbmOptions = generatePBMOptions(systemConfig.pbm || []);

        const templateData = {
            PBM_OPTIONS: pbmOptions
        };

        return renderTemplate(addTemplate, templateData);

    } catch (error) {
        console.error('Failed to generate add model HTML:', error);
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
        'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,Authorization,X-Requested-With,Accept'
    };

    try {
        await client.connect();

        const method = event.httpMethod;
        const path = event.path || '/clinical-models';
        const queryParams = event.queryStringParameters || {};

        console.log(`${method} ${path}`, queryParams);

        // Handle CORS preflight requests
        if (method === 'OPTIONS') {
            return {
                statusCode: 200,
                headers,
                body: ''
            };
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
                const addHTML = await generateAddModelHTML(client);
                return {
                    statusCode: 200,
                    headers,
                    body: addHTML
                };
            }

            // Default: load clinical models list
            console.log('📊 Loading clinical models...');
            const models = await getClinicalModels(client);
            const modelsHTML = await generateClinicalModelsHTML(client, models);

            return {
                statusCode: 200,
                headers,
                body: modelsHTML
            };
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