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

// Insert new report into database
async function createReport(client, reportData) {
    try {
        const query = `
            INSERT INTO application.prism_rfp_reports (
                report_name, report_type, pbm, organization,
                effective_from, effective_to,
                price_model_id, clinical_model_id,
                status, created_by
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
            ) RETURNING report_id, report_name, status
        `;

        const values = [
            reportData.report_name,
            reportData.report_type,
            reportData.pbm,
            reportData.organization || null,
            reportData.effective_from,
            reportData.effective_to,
            reportData.price_model_id,
            reportData.clinical_model_id,
            'pending', // Default status
            reportData.created_by || 'system'
        ];

        const result = await client.query(query, values);
        console.log(`✅ Report created with ID: ${result.rows[0].report_id}`);
        return result.rows[0];
    } catch (error) {
        console.error('Error creating report:', error);
        throw error;
    }
}

// Get reports list from database
async function getReportsList(client, filters = {}) {
    try {
        let whereClauses = [];
        let params = [];
        let paramCounter = 1;

        // Add filters if provided
        if (filters.pbm) {
            whereClauses.push(`r.pbm = $${paramCounter}`);
            params.push(filters.pbm);
            paramCounter++;
        }

        if (filters.status) {
            whereClauses.push(`r.status = $${paramCounter}`);
            params.push(filters.status);
            paramCounter++;
        }

        const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const query = `
            SELECT
                r.report_id,
                r.report_name,
                r.report_type,
                r.pbm,
                r.organization,
                r.effective_from,
                r.effective_to,
                r.status,
                r.date_run,
                r.created_at,
                pm.name as price_model_name,
                cm.model_name as clinical_model_name
            FROM application.prism_rfp_reports r
            LEFT JOIN application.prism_price_configuration pm ON r.price_model_id = pm.id
            LEFT JOIN application.prism_clinical_models cm ON r.clinical_model_id = cm.model_id
            ${whereClause}
            ORDER BY r.created_at DESC
            LIMIT 100
        `;

        const result = await client.query(query, params);
        console.log(`✅ Fetched ${result.rows.length} reports`);
        return result.rows;
    } catch (error) {
        console.error('Error fetching reports list:', error);
        throw error;
    }
}

// Generate report rows HTML
function generateReportRowsHTML(reports) {
    if (!reports || reports.length === 0) {
        return ''; // Return empty, let the empty state in the template show
    }

    let html = '';
    reports.forEach(report => {
        // Format dates
        const dateRange = `${formatDate(report.effective_from)} - ${formatDate(report.effective_to)}`;
        const dateRun = report.date_run ? formatDateTime(report.date_run) : formatDateTime(report.created_at);

        // Status badge
        const statusBadge = getStatusBadge(report.status);

        html += `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4">
                    <input type="checkbox"
                           class="report-checkbox rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                           value="${report.report_id}"
                           onchange="updateCompareButton()">
                </td>
                <td class="px-6 py-4">
                    <div class="text-sm font-medium text-gray-900">${escapeHtml(report.report_name)}</div>
                    <div class="text-xs text-gray-500 mt-1">${escapeHtml(report.report_type || 'standard')}</div>
                </td>
                <td class="px-6 py-4">
                    <div class="text-sm text-gray-900">${escapeHtml(report.pbm)}</div>
                    ${report.organization ? `<div class="text-xs text-gray-500">${escapeHtml(report.organization)}</div>` : ''}
                </td>
                <td class="px-6 py-4">
                    <div class="text-sm text-gray-900">${dateRange}</div>
                </td>
                <td class="px-6 py-4">
                    <div class="text-sm text-gray-500">${dateRun}</div>
                </td>
                <td class="px-6 py-4">
                    ${statusBadge}
                </td>
                <td class="px-6 py-4 text-center">
                    <div class="relative inline-block text-left">
                        <button onclick="toggleReportMenu(${report.report_id})"
                                class="text-gray-400 hover:text-gray-600 focus:outline-none"
                                aria-label="Options">
                            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path>
                            </svg>
                        </button>
                        <div id="report-menu-${report.report_id}"
                             class="hidden absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-10">
                            <div class="py-1" role="menu">
                                <button onclick="editReport(${report.report_id})"
                                        class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center"
                                        role="menuitem">
                                    <svg class="w-4 h-4 mr-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                                    </svg>
                                    Edit Report
                                </button>
                                <button onclick="runReport(${report.report_id})"
                                        class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center"
                                        role="menuitem">
                                    <svg class="w-4 h-4 mr-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path>
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                    </svg>
                                    Run Report
                                </button>
                                <button onclick="deleteReport(${report.report_id}, '${escapeHtml(report.report_name)}')"
                                        class="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100 flex items-center"
                                        role="menuitem">
                                    <svg class="w-4 h-4 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                    </svg>
                                    Delete Report
                                </button>
                            </div>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    });

    return html;
}

// Helper: Format date (YYYY-MM-DD)
function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Helper: Format date time
function formatDateTime(dateStr) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Helper: Get status badge HTML
function getStatusBadge(status) {
    const badges = {
        'pending': '<span class="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">Pending</span>',
        'running': '<span class="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">Running</span>',
        'completed': '<span class="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">Completed</span>',
        'failed': '<span class="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">Failed</span>'
    };
    return badges[status] || badges['pending'];
}

// Helper: Escape HTML to prevent XSS
function escapeHtml(text) {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
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

                // Build filters from query params
                const filters = {};
                if (queryParams.pbm) filters.pbm = queryParams.pbm;
                if (queryParams.status) filters.status = queryParams.status;

                // Fetch reports list from database
                const reports = await getReportsList(client, filters);
                const reportsHTML = generateReportRowsHTML(reports);

                const templateData = {
                    PBM_FILTER_OPTIONS: pbmFilterOptions,
                    REPORTS_HTML: reportsHTML
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
            console.log('💾 Saving new report...');

            try {
                // Parse form data from body
                const body = event.body || '';
                const formData = {};

                // Parse URL-encoded form data
                if (event.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
                    body.split('&').forEach(pair => {
                        const [key, value] = pair.split('=');
                        formData[decodeURIComponent(key)] = decodeURIComponent(value || '');
                    });
                }

                console.log('📝 Form data:', formData);

                // Validate required fields
                const requiredFields = ['report_name', 'report_type', 'pbm', 'effective_from', 'effective_to', 'price_model_id', 'clinical_model_id'];
                const missingFields = requiredFields.filter(field => !formData[field]);

                if (missingFields.length > 0) {
                    return {
                        statusCode: 400,
                        headers: {
                            'Content-Type': 'text/html',
                            ...corsHeaders
                        },
                        body: `
                            <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                                <strong>Error!</strong> Missing required fields: ${missingFields.join(', ')}
                            </div>
                        `
                    };
                }

                // Create report in database
                const newReport = await createReport(client, formData);

                // Return success message and refresh the reports table
                return {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'text/html',
                        ...corsHeaders
                    },
                    body: `
                        <div class="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
                            <strong>Success!</strong> Report "${newReport.report_name}" has been created successfully.
                        </div>
                        <script>
                            setTimeout(() => {
                                closeModal();
                                // Refresh the reports table
                                htmx.ajax('GET', 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/rfp-reports', {
                                    target: '#reports-container',
                                    swap: 'innerHTML'
                                });
                            }, 1500);
                        </script>
                    `
                };

            } catch (error) {
                console.error('💥 Error creating report:', error);
                return {
                    statusCode: 500,
                    headers: {
                        'Content-Type': 'text/html',
                        ...corsHeaders
                    },
                    body: `
                        <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                            <strong>Error!</strong> Failed to create report: ${error.message}
                        </div>
                    `
                };
            }
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
