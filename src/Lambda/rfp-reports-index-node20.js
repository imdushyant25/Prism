const AWS = require('aws-sdk');
const { Client } = require('pg');

const s3 = new AWS.S3();

// Cache templates
let templateCache = {};

async function getTemplate(key, bypassCache = false) {
    // Check cache unless bypass is requested
    if (!bypassCache && templateCache[key]) {
        return templateCache[key];
    }

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
    let previousTemplate = '';
    let iterations = 0;
    const maxIterations = 5;

    while (template !== previousTemplate && iterations < maxIterations) {
        previousTemplate = template;
        template = template.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (match, key, content) => {
            const value = data[key];
            return (value && value !== false && value !== 0 && value !== '' && value !== null && value !== undefined) ? content : '';
        });
        iterations++;
    }

    // Handle inverted conditional blocks {{^KEY}} content {{/KEY}}
    template = template.replace(/\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (match, key, content) => {
        const value = data[key];
        return (!value || value === false || value === 0 || value === '' || value === null || value === undefined) ? content : '';
    });

    // Handle double-brace variable replacements {{KEY}}
    template = template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return data[key] !== undefined ? data[key] : '';
    });

    return template;
}

// Get system configuration from database
async function getSystemConfig(client, configType = null) {
    try {
        let query;
        let params = [];

        if (configType) {
            // Get specific config type
            query = `
                SELECT config_code, display_name, config_type, display_order
                FROM application.prism_system_config
                WHERE config_level = 1
                  AND config_type = $1
                  AND is_active = true
                ORDER BY display_order, config_code
            `;
            params = [configType];
        } else {
            // Get all config types
            query = `
                SELECT config_code, display_name, config_type, display_order
                FROM application.prism_system_config
                WHERE config_level = 1
                  AND config_type IN ('pbm', 'report_type')
                  AND is_active = true
                ORDER BY config_type, display_order, config_code
            `;
        }

        const result = await client.query(query, params);

        // Transform rows into config object grouped by type
        const config = {};
        result.rows.forEach(row => {
            if (!config[row.config_type]) {
                config[row.config_type] = [];
            }
            config[row.config_type].push({
                code: row.config_code,
                name: row.display_name,
                order: row.display_order
            });
        });

        return config;
    } catch (error) {
        console.error('Error fetching system config:', error);
        throw error;
    }
}

// Get active price models from prism_price_configuration
async function getActivePriceModels(client, pbmCode = null) {
    try {
        let query;
        let params = [];

        if (pbmCode) {
            // Get models for specific PBM
            query = `
                SELECT id, name
                FROM application.prism_price_configuration
                WHERE is_active = true
                  AND config_type = 'MODELING'
                  AND pbm_code = $1
                ORDER BY name ASC
            `;
            params = [pbmCode];
        } else {
            // Get all active modeling configurations (for initial load, though we'll load dynamically)
            query = `
                SELECT id, name, pbm_code
                FROM application.prism_price_configuration
                WHERE is_active = true
                  AND config_type = 'MODELING'
                ORDER BY pbm_code, name ASC
            `;
        }

        const result = await client.query(query, params);
        return result.rows;
    } catch (error) {
        console.error('Error fetching active price models:', error);
        throw error;
    }
}

// Get active clinical models filtered by PBM
async function getActiveClinicalModels(client, pbmCode = null) {
    try {
        let query;
        let params = [];

        if (pbmCode) {
            // Get models for specific PBM using the join with prism_model_criteria
            query = `
                SELECT DISTINCT pcm.model_id, pcm.model_name
                FROM application.prism_clinical_models pcm
                INNER JOIN application.prism_model_criteria pmc ON pcm.model_id = pmc.model_id
                WHERE pcm.is_active = true
                  AND pmc.pbm = $1
                ORDER BY pcm.model_name ASC
            `;
            params = [pbmCode];
        } else {
            // Get all active clinical models (for initial load, though we'll load dynamically)
            query = `
                SELECT DISTINCT pcm.model_id, pcm.model_name
                FROM application.prism_clinical_models pcm
                WHERE pcm.is_active = true
                ORDER BY pcm.model_name ASC
            `;
        }

        const result = await client.query(query, params);
        return result.rows;
    } catch (error) {
        console.error('Error fetching active clinical models:', error);
        throw error;
    }
}

// Generate dropdown options HTML from system config
function generateDropdownOptions(configList, placeholder = 'Select...', allowEmpty = true) {
    if (!configList || configList.length === 0) {
        return `<option value="">No options available</option>`;
    }

    let options = allowEmpty ? `<option value="">${placeholder}</option>` : '';
    configList.forEach(item => {
        options += `<option value="${item.code}">${item.name}</option>`;
    });

    return options;
}

// Generate Price Model options HTML
function generatePriceModelOptions(priceModels) {
    if (!priceModels || priceModels.length === 0) {
        return '<option value="">No active price models available</option>';
    }

    let options = '<option value="">Select Price Model...</option>';
    priceModels.forEach(model => {
        options += `<option value="${model.id}">${model.name}</option>`;
    });

    return options;
}

// Generate Clinical Model options HTML
function generateClinicalModelOptions(clinicalModels) {
    if (!clinicalModels || clinicalModels.length === 0) {
        return '<option value="">No active clinical models available</option>';
    }

    let options = '<option value="">Select Clinical Model...</option>';
    clinicalModels.forEach(model => {
        options += `<option value="${model.model_id}">${model.model_name}</option>`;
    });

    return options;
}

// Generate Create Report Modal HTML
async function generateCreateReportModalHTML(client) {
    try {
        console.log('🔄 Starting generateCreateReportModalHTML');

        // Load template
        const modalTemplate = await getTemplate('rfp-report-create-modal.html');

        // Get system config for PBMs and Report Types
        const systemConfig = await getSystemConfig(client);
        const pbmOptions = generateDropdownOptions(systemConfig.pbm || [], 'Select PBM...');
        const reportTypeOptions = generateDropdownOptions(systemConfig.report_type || [], 'Select Report Type...');
        console.log(`✅ Loaded ${systemConfig.pbm?.length || 0} PBMs and ${systemConfig.report_type?.length || 0} report types`);

        // Price models will be loaded dynamically based on PBM selection
        const priceModelOptions = '<option value="">Select PBM first...</option>';
        console.log('✅ Price models will be loaded dynamically based on PBM selection');

        // Clinical models will be loaded dynamically based on PBM selection
        const clinicalModelOptions = '<option value="">Select PBM first...</option>';
        console.log('✅ Clinical models will be loaded dynamically based on PBM selection');

        // Organization options (keeping null for now as per requirement)
        const organizationOptions = '<option value="">Select Organization...</option><option value="">None</option>';

        // Prepare template data
        const templateData = {
            PBM_OPTIONS: pbmOptions,
            REPORT_TYPE_OPTIONS: reportTypeOptions,
            ORGANIZATION_OPTIONS: organizationOptions,
            PRICE_MODEL_OPTIONS: priceModelOptions,
            CLINICAL_MODEL_OPTIONS: clinicalModelOptions
        };

        const renderedHTML = renderTemplate(modalTemplate, templateData);
        console.log('✅ Create report modal rendered successfully');

        return renderedHTML;

    } catch (error) {
        console.error('💥 Failed to generate create report modal HTML:', error);
        throw error;
    }
}

// Main Lambda handler
const handler = async (event) => {
    console.log('📥 RFP Reports Lambda invoked:', JSON.stringify(event, null, 2));

    const client = new Client({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('✅ Database connected');

        const method = event.httpMethod || event.requestContext?.http?.method || 'GET';
        const queryParams = event.queryStringParameters || {};

        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,hx-boosted,hx-history-restore-request,Authorization,X-Requested-With,Accept'
        };

        // Handle OPTIONS request
        if (method === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: ''
            };
        }

        // Handle GET requests
        if (method === 'GET') {

            // Handle price models request by PBM
            if (queryParams.component === 'price-models' && queryParams.pbm) {
                console.log(`📋 Fetching price models for PBM: ${queryParams.pbm}`);
                try {
                    const priceModels = await getActivePriceModels(client, queryParams.pbm);
                    const priceModelOptions = generatePriceModelOptions(priceModels);

                    return {
                        statusCode: 200,
                        headers: {
                            'Content-Type': 'text/html',
                            ...corsHeaders
                        },
                        body: priceModelOptions
                    };
                } catch (error) {
                    console.error('💥 Error fetching price models:', error);
                    return {
                        statusCode: 500,
                        headers: {
                            'Content-Type': 'text/html',
                            ...corsHeaders
                        },
                        body: '<option value="">Error loading price models</option>'
                    };
                }
            }

            // Handle clinical models request by PBM
            if (queryParams.component === 'clinical-models' && queryParams.pbm) {
                console.log(`📋 Fetching clinical models for PBM: ${queryParams.pbm}`);
                try {
                    const clinicalModels = await getActiveClinicalModels(client, queryParams.pbm);
                    const clinicalModelOptions = generateClinicalModelOptions(clinicalModels);

                    return {
                        statusCode: 200,
                        headers: {
                            'Content-Type': 'text/html',
                            ...corsHeaders
                        },
                        body: clinicalModelOptions
                    };
                } catch (error) {
                    console.error('💥 Error fetching clinical models:', error);
                    return {
                        statusCode: 500,
                        headers: {
                            'Content-Type': 'text/html',
                            ...corsHeaders
                        },
                        body: '<option value="">Error loading clinical models</option>'
                    };
                }
            }

            // Handle create report modal request
            if (queryParams.component === 'create-report') {
                console.log('📋 Loading create report modal...');
                try {
                    const modalHTML = await generateCreateReportModalHTML(client);
                    return {
                        statusCode: 200,
                        headers: {
                            'Content-Type': 'text/html',
                            ...corsHeaders
                        },
                        body: modalHTML
                    };
                } catch (error) {
                    console.error('💥 Error generating create report modal:', error);
                    return {
                        statusCode: 500,
                        headers: {
                            'Content-Type': 'text/html',
                            ...corsHeaders
                        },
                        body: `<div class="text-red-600">Error loading create report form: ${error.message}</div>`
                    };
                }
            }

            // Default: Return RFP reports table
            console.log('📋 Loading RFP reports table...');
            try {
                const tableTemplate = await getTemplate('rfp-reports-table.html');

                // Get system config for PBM filter options
                const systemConfig = await getSystemConfig(client);
                const pbmFilterOptions = generateDropdownOptions(systemConfig.pbm || [], 'All PBMs');

                const templateData = {
                    PBM_FILTER_OPTIONS: pbmFilterOptions,
                    REPORTS_HTML: '' // Empty for now - will be populated when we query the database
                };

                const renderedHTML = renderTemplate(tableTemplate, templateData);

                return {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'text/html',
                        ...corsHeaders
                    },
                    body: renderedHTML
                };
            } catch (error) {
                console.error('💥 Error loading RFP reports table:', error);
                return {
                    statusCode: 500,
                    headers: {
                        'Content-Type': 'text/html',
                        ...corsHeaders
                    },
                    body: `<div class="text-red-600">Error loading reports: ${error.message}</div>`
                };
            }
        }

        // Handle POST requests
        if (method === 'POST' && queryParams.action === 'run-report') {
            console.log('🚀 Run report requested (placeholder)');

            // For now, just return "Coming Soon" message
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'text/html',
                    ...corsHeaders
                },
                body: `
                    <div class="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded">
                        <strong>Coming Soon!</strong> Report generation will be available in a future update.
                    </div>
                    <script>
                        setTimeout(() => {
                            closeModal();
                        }, 2000);
                    </script>
                `
            };
        }

        // Default response
        return {
            statusCode: 400,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            },
            body: JSON.stringify({ error: 'Invalid request' })
        };

    } catch (error) {
        console.error('💥 Lambda error:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: error.message })
        };
    } finally {
        await client.end();
        console.log('✅ Database connection closed');
    }
};

exports.handler = handler;
