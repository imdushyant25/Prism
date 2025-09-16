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
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        const value = data[key];
        return value !== undefined && value !== null ? String(value) : '';
    });
}

// Generate price modeling filters HTML using system config
async function generatePriceFiltersHTML(client) {
    try {
        const filtersTemplate = await getTemplate('price-filters.html');
        
        // Get dropdown options from system config
        const configQuery = `
            SELECT 
                config_type,
                ARRAY_AGG(
                    json_build_object(
                        'code', config_code,
                        'name', display_name,
                        'is_default', is_default
                    ) ORDER BY display_order
                ) as options
            FROM application.prism_system_config 
            WHERE config_type IN ('pbm', 'client_size', 'contract_type', 'pricing_type')
              AND is_active = true
            GROUP BY config_type
        `;
        
        const result = await client.query(configQuery);
        const configData = {};
        
        result.rows.forEach(row => {
            configData[row.config_type] = row.options;
        });
        
        // Build HTML options for each dropdown
        const pbmOptions = (configData.pbm || [])
            .map((option, index) => `<option value="${option.code}" ${option.is_default || index === 0 ? 'selected' : ''}>${option.name}</option>`)
            .join('');
            
        const clientSizeOptions = (configData.client_size || [])
            .map(option => `<option value="${option.code}">${option.name}</option>`)
            .join('');
            
        const contractTypeOptions = (configData.contract_type || [])
            .map(option => `<option value="${option.code}">${option.name}</option>`)
            .join('');
            
        const pricingTypeOptions = (configData.pricing_type || [])
            .map(option => `<option value="${option.code}">${option.name}</option>`)
            .join('');
        
        const statusOptions = [
            '<option value="active">Active</option>',
            '<option value="inactive">Inactive</option>',
            '<option value="baseline">Baseline</option>',
            '<option value="draft">Draft</option>'
        ].join('');
        
        // Render template with dynamic data
        const filterData = {
            PBM_OPTIONS: pbmOptions,
            CLIENT_SIZE_OPTIONS: clientSizeOptions,
            CONTRACT_TYPE_OPTIONS: contractTypeOptions,
            PRICING_TYPE_OPTIONS: pricingTypeOptions,
            STATUS_OPTIONS: statusOptions
        };
        
        return renderTemplate(filtersTemplate, filterData);
        
    } catch (error) {
        console.error('Failed to generate price filters:', error);
        throw error;
    }
}

// Get price models with filtering
async function getPriceModels(client, filters = {}) {
    try {
        let whereClause = 'WHERE is_active = true';
        const params = [];
        let paramCount = 0;
        
        // Build WHERE clause based on filters
        if (filters.pbm_filter && filters.pbm_filter.trim() !== '') {
            paramCount++;
            whereClause += ` AND pbm_code = $${paramCount}`;
            params.push(filters.pbm_filter.trim());
        }
        
        if (filters.client_size_filter && filters.client_size_filter.trim() !== '') {
            paramCount++;
            whereClause += ` AND client_size = $${paramCount}`;
            params.push(filters.client_size_filter.trim());
        }
        
        if (filters.contract_type_filter && filters.contract_type_filter.trim() !== '') {
            paramCount++;
            whereClause += ` AND contract_type = $${paramCount}`;
            params.push(filters.contract_type_filter.trim());
        }
        
        if (filters.pricing_type_filter && filters.pricing_type_filter.trim() !== '') {
            paramCount++;
            whereClause += ` AND pricing_type = $${paramCount}`;
            params.push(filters.pricing_type_filter.trim());
        }
        
        if (filters.status_filter && filters.status_filter.trim() !== '') {
            paramCount++;
            if (filters.status_filter === 'baseline') {
                whereClause += ` AND is_baseline = true`;
            } else if (filters.status_filter === 'active') {
                whereClause += ` AND is_active = true AND is_baseline = false`;
            } else if (filters.status_filter === 'inactive') {
                whereClause += ` AND is_active = false`;
            }
        }
        
        const modelsQuery = `
            SELECT 
                pm.*,
                -- Extract key metrics from pricing structure
                pricing_structure->'overall_fee_credit'->>'pepm_rebate_credit' as pepm_credit,
                pricing_structure->'retail'->'brand'->>'discount' as retail_brand_discount,
                pricing_structure->'retail'->'generic'->>'discount' as retail_generic_discount,
                pricing_structure->'specialty_mail'->'brand'->>'rebate' as specialty_rebate
            FROM application.prism_price_modeling pm
            ${whereClause}
            ORDER BY pbm_code, client_size, name
        `;
        
        console.log('Executing query:', modelsQuery);
        console.log('With parameters:', params);
        
        const result = await client.query(modelsQuery, params);
        return result.rows;
        
    } catch (error) {
        console.error('Failed to get price models:', error);
        throw error;
    }
}

// Generate price models table HTML
async function generatePriceModelsHTML(client, models) {
    try {
        const tableTemplate = await getTemplate('price-models-table.html');
        
        if (models.length === 0) {
            return `
                <div class="bg-white rounded-lg border p-8">
                    <div class="text-center text-gray-500">
                        <svg class="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                        </svg>
                        <h3 class="text-lg font-medium text-gray-900 mb-2">No Price Models Found</h3>
                        <p class="text-gray-500">Try adjusting your filters or create a new price model</p>
                    </div>
                </div>
            `;
        }
        
        // Get business-friendly labels from system config
        const configQuery = `
            SELECT config_type, config_code, display_name 
            FROM application.prism_system_config 
            WHERE config_type IN ('pbm', 'client_size', 'contract_type', 'pricing_type')
              AND is_active = true
        `;
        const configResult = await client.query(configQuery);
        
        const configLabels = {};
        configResult.rows.forEach(row => {
            if (!configLabels[row.config_type]) configLabels[row.config_type] = {};
            configLabels[row.config_type][row.config_code] = row.display_name;
        });
        
        // Generate table rows
        const tableRows = models.map(model => {
            const pbmLabel = configLabels.pbm?.[model.pbm_code] || model.pbm_code;
            const clientSizeLabel = configLabels.client_size?.[model.client_size] || model.client_size;
            const contractTypeLabel = configLabels.contract_type?.[model.contract_type] || model.contract_type;
            const pricingTypeLabel = configLabels.pricing_type?.[model.pricing_type] || model.pricing_type;
            
            // Format metrics for display
            const pepmCredit = model.pepm_credit ? `$${parseFloat(model.pepm_credit).toFixed(2)}` : 'N/A';
            const retailBrandDiscount = model.retail_brand_discount ? `${parseFloat(model.retail_brand_discount).toFixed(1)}%` : 'N/A';
            const retailGenericDiscount = model.retail_generic_discount ? `${parseFloat(model.retail_generic_discount).toFixed(1)}%` : 'N/A';
            const specialtyRebate = model.specialty_rebate ? `$${parseFloat(model.specialty_rebate).toFixed(0)}` : 'N/A';
            
            // Create status badges
            const statusBadges = [];
            if (model.is_baseline) statusBadges.push('<span class="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded-full">Baseline</span>');
            if (model.is_active) statusBadges.push('<span class="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">Active</span>');
            if (!model.is_active) statusBadges.push('<span class="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full">Inactive</span>');
            
            const createdDate = new Date(model.created_at).toLocaleDateString();
            
            return `
                <tr class="border-b hover:bg-blue-50 transition-colors">
                    <td class="px-4 py-4"><input type="checkbox" class="rounded" value="${model.id}"></td>
                    <td class="px-6 py-4">
                        <div class="text-sm font-medium text-gray-900">${model.name}</div>
                        <div class="text-xs text-gray-500 mt-1">
                            ${statusBadges.join(' ')} • Created ${createdDate}
                        </div>
                        ${model.description ? `<div class="text-xs text-gray-600 mt-1">${model.description}</div>` : ''}
                    </td>
                    <td class="px-6 py-4">
                        <span class="bg-blue-600 text-white px-3 py-1 rounded-full text-sm font-medium">${pbmLabel}</span>
                    </td>
                    <td class="px-6 py-4">
                        <span class="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">${clientSizeLabel}</span>
                    </td>
                    <td class="px-6 py-4">
                        <div class="text-sm text-gray-800">${contractTypeLabel}</div>
                        <div class="text-xs text-gray-500">${pricingTypeLabel}</div>
                    </td>
                    <td class="px-6 py-4 text-center">
                        <div class="text-xs space-y-1">
                            <div>PEPM: <span class="font-semibold">${pepmCredit}</span></div>
                            <div>Retail Brand: <span class="font-semibold">${retailBrandDiscount}</span></div>
                            <div>Generic: <span class="font-semibold">${retailGenericDiscount}</span></div>
                            ${specialtyRebate !== 'N/A' ? `<div>Specialty: <span class="font-semibold">${specialtyRebate}</span></div>` : ''}
                        </div>
                    </td>
                    <td class="px-6 py-4">
                        <div class="flex items-center justify-center gap-2">
                            <button onclick="editPriceModel('${model.id}')" 
                                    class="text-blue-600 hover:text-blue-800 p-1 rounded" title="Edit">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                                </svg>
                            </button>
                            <button onclick="clonePriceModel('${model.id}')" 
                                    class="text-green-600 hover:text-green-800 p-1 rounded" title="Clone">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                                </svg>
                            </button>
                            <button onclick="analyzePriceModel('${model.id}')" 
                                    class="text-purple-600 hover:text-purple-800 p-1 rounded" title="Analyze">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                                </svg>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        
        const tableData = {
            TABLE_ROWS: tableRows,
            TOTAL_COUNT: models.length,
            START_RANGE: models.length > 0 ? 1 : 0,
            END_RANGE: models.length
        };
        
        return renderTemplate(tableTemplate, tableData);
        
    } catch (error) {
        console.error('Failed to generate price models table:', error);
        throw error;
    }
}

// Main Lambda handler
const handler = async (event) => {
    console.log('🚀 Price Modeling Lambda Event:', JSON.stringify(event, null, 2));
    
    const client = new Client({
        host: process.env.DB_HOST || 'prismdb.cluster-cwhkw4c7ykcz.us-east-1.rds.amazonaws.com',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'prism',
        user: process.env.DB_USER || 'prism_admin',
        password: process.env.DB_PASSWORD || 'Prism2024!'
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
        const path = event.path || '/price-models';
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
        
        // Handle component requests (filters, modals, etc.)
        if (queryParams.component === 'filters') {
            console.log('📋 Loading price modeling filters...');
            const filtersHTML = await generatePriceFiltersHTML(client);
            
            return {
                statusCode: 200,
                headers,
                body: filtersHTML
            };
        }
        
        // Handle price models list (GET with filters or POST with form data)
        if (method === 'GET' || method === 'POST') {
            console.log('📊 Loading price models...');
            
            let filters = {};
            
            if (method === 'POST' && event.body) {
                // Parse form data from POST request
                const params = new URLSearchParams(event.body);
                for (const [key, value] of params) {
                    filters[key] = value;
                }
                console.log('Filters from POST body:', filters);
            } else if (method === 'GET' && queryParams) {
                // Use query parameters from GET request
                filters = queryParams;
                console.log('Filters from GET params:', filters);
            }
            
            const models = await getPriceModels(client, filters);
            const modelsHTML = await generatePriceModelsHTML(client, models);
            
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

module.exports = { handler };