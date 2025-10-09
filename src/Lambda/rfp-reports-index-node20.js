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
async function getSystemConfig(client) {
    try {
        const query = `
            SELECT config_code, display_name, config_type
            FROM application.prism_system_config
            WHERE config_level = 1
              AND config_type = 'pbm'
              AND is_active = true
            ORDER BY display_order, config_code
        `;

        const result = await client.query(query);

        // Transform rows into config object
        const config = {
            pbm: result.rows.map(row => row.config_code)
        };

        return config;
    } catch (error) {
        console.error('Error fetching system config:', error);
        throw error;
    }
}

// Get active price models
async function getActivePriceModels(client) {
    try {
        const query = `
            SELECT id, name, description, created_at
            FROM application.prism_price_modeling
            WHERE is_active = true
            ORDER BY name ASC
        `;

        const result = await client.query(query);
        return result.rows;
    } catch (error) {
        console.error('Error fetching active price models:', error);
        throw error;
    }
}

// Get active clinical models
async function getActiveClinicalModels(client) {
    try {
        const query = `
            SELECT model_id, model_name, description, created_at
            FROM application.prism_clinical_models
            WHERE is_active = true
            ORDER BY model_name ASC
        `;

        const result = await client.query(query);
        return result.rows;
    } catch (error) {
        console.error('Error fetching active clinical models:', error);
        throw error;
    }
}

// Generate PBM options HTML
function generatePBMOptions(pbmList) {
    if (!pbmList || pbmList.length === 0) {
        return '<option value="">No PBMs available</option>';
    }

    let options = '<option value="">Select PBM...</option>';
    pbmList.forEach(pbm => {
        options += `<option value="${pbm}">${pbm}</option>`;
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

        // Get system config for PBMs
        const systemConfig = await getSystemConfig(client);
        const pbmOptions = generatePBMOptions(systemConfig.pbm || []);

        // Get active price models
        const priceModels = await getActivePriceModels(client);
        const priceModelOptions = generatePriceModelOptions(priceModels);
        console.log(`✅ Loaded ${priceModels.length} active price models`);

        // Get active clinical models
        const clinicalModels = await getActiveClinicalModels(client);
        const clinicalModelOptions = generateClinicalModelOptions(clinicalModels);
        console.log(`✅ Loaded ${clinicalModels.length} active clinical models`);

        // Prepare template data
        const templateData = {
            PBM_OPTIONS: pbmOptions,
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
                const pbmFilterOptions = generatePBMOptions(systemConfig.pbm || []);

                const templateData = {
                    PBM_FILTER_OPTIONS: pbmFilterOptions,
                    REPORTS_HTML: '' // Empty for now - no database table yet
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
