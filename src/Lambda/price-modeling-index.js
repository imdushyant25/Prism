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
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        const value = data[key];
        return value !== undefined && value !== null ? String(value) : '';
    });
}

// Parse pricing structure and generate enhanced key metrics display
function generateEnhancedKeyMetrics(pricingStructure, categoryLabels = {}) {
    if (!pricingStructure) return 'N/A';

    const metrics = [];

    // Process each category
    Object.entries(pricingStructure).forEach(([category, data]) => {
        if (category === 'overall_fee_credit') return; // Skip overall fees for now

        const displayName = categoryLabels[category] || category;
        const categoryMetrics = [];

        // Handle blended specialty categories (no brand/generic breakdown)
        if (category.includes('blended_specialty')) {
            const parts = [];
            if (data.rebate) parts.push(`$${data.rebate}`);
            if (data.discount) parts.push(`${data.discount}%`);
            if (data.dispensing_fee) parts.push(`$${data.dispensing_fee}`);

            if (parts.length > 0) {
                categoryMetrics.push(parts.join('+'));
            }
        } else {
            // Handle brand/generic breakdown
            if (data.brand) {
                const brandParts = [];
                if (data.brand.discount) brandParts.push(`${data.brand.discount}%`);
                if (data.brand.rebate) brandParts.push(`$${data.brand.rebate}`);
                if (data.brand.dispensing_fee) brandParts.push(`$${data.brand.dispensing_fee}`);

                if (brandParts.length > 0) {
                    categoryMetrics.push(`B(${brandParts.join('+')})`);
                }
            }

            if (data.generic) {
                const genericParts = [];
                if (data.generic.discount) genericParts.push(`${data.generic.discount}%`);
                if (data.generic.rebate) genericParts.push(`$${data.generic.rebate}`);
                if (data.generic.dispensing_fee) genericParts.push(`$${data.generic.dispensing_fee}`);

                if (genericParts.length > 0) {
                    categoryMetrics.push(`G(${genericParts.join('+')})`);
                }
            }
        }

        // Add category to metrics if it has any values
        if (categoryMetrics.length > 0) {
            metrics.push(`${displayName}: ${categoryMetrics.join(' ')}`);
        }
    });

    return metrics.length > 0 ? metrics.join('<br>• ') : 'N/A';
}

// Generate dropdown options for forms
async function generateDropdownOptions(client) {
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
        WHERE config_type IN ('pbm', 'client_size', 'contract_type', 'pricing_type', 'status')
          AND is_active = true
        GROUP BY config_type
    `;

    const result = await client.query(configQuery);
    const configData = {};

    result.rows.forEach(row => {
        configData[row.config_type] = row.options;
    });

    return {
        pbmOptions: (configData.pbm || [])
            .map(option => `<option value="${option.code}">${option.name}</option>`)
            .join(''),
        clientSizeOptions: (configData.client_size || [])
            .map(option => `<option value="${option.code}">${option.name}</option>`)
            .join(''),
        contractTypeOptions: (configData.contract_type || [])
            .map(option => `<option value="${option.code}">${option.name}</option>`)
            .join(''),
        pricingTypeOptions: (configData.pricing_type || [])
            .map(option => `<option value="${option.code}">${option.name}</option>`)
            .join(''),
        statusOptions: (configData.status || [])
            .map(option => `<option value="${option.code}">${option.name}</option>`)
            .join('')
    };
}

// Generate price modeling filters HTML using system config
async function generatePriceFiltersHTML(client) {
    try {
        const filtersTemplate = await getTemplate('price-filters.html');
        const options = await generateDropdownOptions(client);

        // Build HTML options for each dropdown with defaults for filters
        const pbmOptionsWithDefault = (await client.query(`
            SELECT ARRAY_AGG(
                json_build_object('code', config_code, 'name', display_name, 'is_default', is_default)
                ORDER BY display_order
            ) as options
            FROM application.prism_system_config
            WHERE config_type = 'pbm' AND is_active = true
        `)).rows[0].options.map((option, index) =>
            `<option value="${option.code}" ${option.is_default || index === 0 ? 'selected' : ''}>${option.name}</option>`
        ).join('');

        // Render template with dynamic data
        const filterData = {
            PBM_OPTIONS: pbmOptionsWithDefault,
            CLIENT_SIZE_OPTIONS: options.clientSizeOptions,
            CONTRACT_TYPE_OPTIONS: options.contractTypeOptions,
            PRICING_TYPE_OPTIONS: options.pricingTypeOptions,
            STATUS_OPTIONS: options.statusOptions
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
            WHERE config_type IN ('pbm', 'client_size', 'contract_type', 'pricing_type', 'pricing_category')
              AND is_active = true
        `;
        const configResult = await client.query(configQuery);

        const configLabels = {};
        configResult.rows.forEach(row => {
            if (!configLabels[row.config_type]) configLabels[row.config_type] = {};
            configLabels[row.config_type][row.config_code] = row.display_name;
        });

        // Load the row template
        const rowTemplate = await getTemplate('price-models-row.html');

        // Generate table rows using template
        const tableRows = models.map(model => {
            const pbmLabel = configLabels.pbm?.[model.pbm_code] || model.pbm_code;
            const clientSizeLabel = configLabels.client_size?.[model.client_size] || model.client_size;
            const contractTypeLabel = configLabels.contract_type?.[model.contract_type] || model.contract_type;
            const pricingTypeLabel = configLabels.pricing_type?.[model.pricing_type] || model.pricing_type;

            // Generate enhanced key metrics from pricing structure
            const categoryLabels = configLabels.pricing_category || {};
            const enhancedKeyMetrics = generateEnhancedKeyMetrics(model.pricing_structure, categoryLabels);

            // Create combined price configuration
            const priceConfiguration = `${pbmLabel} • ${clientSizeLabel} • ${contractTypeLabel} • ${pricingTypeLabel}`;

            // Create status badges
            const statusBadges = [];
            if (model.is_baseline) statusBadges.push('<span class="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded-full">Baseline</span>');
            if (model.is_active) statusBadges.push('<span class="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">Active</span>');
            if (!model.is_active) statusBadges.push('<span class="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full">Inactive</span>');

            const createdDate = new Date(model.created_at).toLocaleDateString();
            const modelDescription = model.description ? `<div class="text-xs text-gray-600 mt-1">${model.description}</div>` : '';

            // Render row template with data
            const rowData = {
                MODEL_ID: model.id,
                MODEL_NAME: model.name,
                STATUS_BADGES: statusBadges.join(' '),
                CREATED_DATE: createdDate,
                MODEL_DESCRIPTION: modelDescription,
                PRICE_CONFIGURATION: priceConfiguration,
                ENHANCED_KEY_METRICS: enhancedKeyMetrics
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
        console.error('Failed to generate price models table:', error);
        throw error;
    }
}

// Generate add price model form HTML
async function generateAddModelHTML(client) {
    try {
        const addTemplate = await getTemplate('price-model-add.html');
        const options = await generateDropdownOptions(client);

        const addData = {
            PBM_OPTIONS: options.pbmOptions,
            CLIENT_SIZE_OPTIONS: options.clientSizeOptions,
            CONTRACT_TYPE_OPTIONS: options.contractTypeOptions,
            PRICING_TYPE_OPTIONS: options.pricingTypeOptions
        };

        return renderTemplate(addTemplate, addData);

    } catch (error) {
        console.error('Failed to generate add model form:', error);
        throw error;
    }
}

// Generate edit price model form HTML
async function generateEditModelHTML(client, modelId) {
    try {
        const editTemplate = await getTemplate('price-model-edit.html');
        const options = await generateDropdownOptions(client);

        // Get the model data
        const modelQuery = `
            SELECT * FROM application.prism_price_modeling
            WHERE id = $1 AND is_active = true
        `;
        const modelResult = await client.query(modelQuery, [modelId]);

        if (modelResult.rows.length === 0) {
            throw new Error('Price model not found');
        }

        const model = modelResult.rows[0];
        const pricingStructure = model.pricing_structure || {};

        // Generate selected options for dropdowns
        const pbmOptionsSelected = options.pbmOptions.replace(
            `value="${model.pbm_code}"`,
            `value="${model.pbm_code}" selected`
        );
        const clientSizeOptionsSelected = options.clientSizeOptions.replace(
            `value="${model.client_size}"`,
            `value="${model.client_size}" selected`
        );
        const contractTypeOptionsSelected = options.contractTypeOptions.replace(
            `value="${model.contract_type}"`,
            `value="${model.contract_type}" selected`
        );
        const pricingTypeOptionsSelected = options.pricingTypeOptions.replace(
            `value="${model.pricing_type}"`,
            `value="${model.pricing_type}" selected`
        );

        // Extract pricing data with null checks
        const getNestedValue = (obj, path) => {
            return path.split('.').reduce((current, key) =>
                current && current[key] !== undefined ? current[key] : '', obj);
        };

        const editData = {
            MODEL_ID: model.id,
            MODEL_NAME: model.name,
            DESCRIPTION: model.description || '',
            PBM_OPTIONS: pbmOptionsSelected,
            CLIENT_SIZE_OPTIONS: clientSizeOptionsSelected,
            CONTRACT_TYPE_OPTIONS: contractTypeOptionsSelected,
            PRICING_TYPE_OPTIONS: pricingTypeOptionsSelected,
            IS_ACTIVE_CHECKED: model.is_active ? 'checked' : '',
            IS_BASELINE_CHECKED: model.is_baseline ? 'checked' : '',

            // Overall fees
            OVERALL_PEPM_REBATE_CREDIT: getNestedValue(pricingStructure, 'overall_fee_credit.pepm_rebate_credit'),
            OVERALL_PRICING_FEE: getNestedValue(pricingStructure, 'overall_fee_credit.pricing_fee'),
            OVERALL_INHOUSE_PHARMACY_FEE: getNestedValue(pricingStructure, 'overall_fee_credit.inhouse_pharmacy_fee'),

            // Retail
            RETAIL_BRAND_REBATE: getNestedValue(pricingStructure, 'retail.brand.rebate'),
            RETAIL_BRAND_DISCOUNT: getNestedValue(pricingStructure, 'retail.brand.discount'),
            RETAIL_BRAND_DISPENSING_FEE: getNestedValue(pricingStructure, 'retail.brand.dispensing_fee'),
            RETAIL_GENERIC_REBATE: getNestedValue(pricingStructure, 'retail.generic.rebate'),
            RETAIL_GENERIC_DISCOUNT: getNestedValue(pricingStructure, 'retail.generic.discount'),
            RETAIL_GENERIC_DISPENSING_FEE: getNestedValue(pricingStructure, 'retail.generic.dispensing_fee'),

            // Retail 90
            RETAIL_90_BRAND_REBATE: getNestedValue(pricingStructure, 'retail_90.brand.rebate'),
            RETAIL_90_BRAND_DISCOUNT: getNestedValue(pricingStructure, 'retail_90.brand.discount'),
            RETAIL_90_BRAND_DISPENSING_FEE: getNestedValue(pricingStructure, 'retail_90.brand.dispensing_fee'),
            RETAIL_90_GENERIC_REBATE: getNestedValue(pricingStructure, 'retail_90.generic.rebate'),
            RETAIL_90_GENERIC_DISCOUNT: getNestedValue(pricingStructure, 'retail_90.generic.discount'),
            RETAIL_90_GENERIC_DISPENSING_FEE: getNestedValue(pricingStructure, 'retail_90.generic.dispensing_fee'),

            // Mail
            MAIL_BRAND_REBATE: getNestedValue(pricingStructure, 'mail.brand.rebate'),
            MAIL_BRAND_DISCOUNT: getNestedValue(pricingStructure, 'mail.brand.discount'),
            MAIL_BRAND_DISPENSING_FEE: getNestedValue(pricingStructure, 'mail.brand.dispensing_fee'),
            MAIL_GENERIC_REBATE: getNestedValue(pricingStructure, 'mail.generic.rebate'),
            MAIL_GENERIC_DISCOUNT: getNestedValue(pricingStructure, 'mail.generic.discount'),
            MAIL_GENERIC_DISPENSING_FEE: getNestedValue(pricingStructure, 'mail.generic.dispensing_fee'),

            // Specialty Mail
            SPECIALTY_MAIL_BRAND_REBATE: getNestedValue(pricingStructure, 'specialty_mail.brand.rebate'),
            SPECIALTY_MAIL_BRAND_DISCOUNT: getNestedValue(pricingStructure, 'specialty_mail.brand.discount'),
            SPECIALTY_MAIL_BRAND_DISPENSING_FEE: getNestedValue(pricingStructure, 'specialty_mail.brand.dispensing_fee'),
            SPECIALTY_MAIL_GENERIC_REBATE: getNestedValue(pricingStructure, 'specialty_mail.generic.rebate'),
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
        console.error('Failed to generate edit model form:', error);
        throw error;
    }
}

// Create new price model
async function createPriceModel(client, formData) {
    try {

        const pricingStructure = {};

        // Overall fees
        if (formData.overall_pepm_rebate_credit || formData.overall_pricing_fee || formData.overall_inhouse_pharmacy_fee) {
            pricingStructure.overall_fee_credit = {};
            if (formData.overall_pemp_rebate_credit) pricingStructure.overall_fee_credit.pepm_rebate_credit = parseFloat(formData.overall_pemp_rebate_credit);
            if (formData.overall_pricing_fee) pricingStructure.overall_fee_credit.pricing_fee = parseFloat(formData.overall_pricing_fee);
            if (formData.overall_inhouse_pharmacy_fee) pricingStructure.overall_fee_credit.inhouse_pharmacy_fee = parseFloat(formData.overall_inhouse_pharmacy_fee);
        }

        // Build other structures
        const categories = ['retail', 'retail_90', 'mail', 'specialty_mail'];
        categories.forEach(category => {
            const categoryData = {};

            // Brand data
            const brandData = {};
            if (formData[`${category}_brand_rebate`]) brandData.rebate = parseFloat(formData[`${category}_brand_rebate`]);
            if (formData[`${category}_brand_discount`]) brandData.discount = parseFloat(formData[`${category}_brand_discount`]);
            if (formData[`${category}_brand_dispensing_fee`]) brandData.dispensing_fee = parseFloat(formData[`${category}_brand_dispensing_fee`]);
            if (Object.keys(brandData).length > 0) categoryData.brand = brandData;

            // Generic data
            const genericData = {};
            if (formData[`${category}_generic_rebate`]) genericData.rebate = parseFloat(formData[`${category}_generic_rebate`]);
            if (formData[`${category}_generic_discount`]) genericData.discount = parseFloat(formData[`${category}_generic_discount`]);
            if (formData[`${category}_generic_dispensing_fee`]) genericData.dispensing_fee = parseFloat(formData[`${category}_generic_dispensing_fee`]);
            if (Object.keys(genericData).length > 0) categoryData.generic = genericData;

            if (Object.keys(categoryData).length > 0) {
                pricingStructure[category] = categoryData;
            }
        });

        // Blended specialty categories
        ['ldd_blended_specialty', 'non_ldd_blended_specialty'].forEach(category => {
            const categoryData = {};
            if (formData[`${category}_rebate`]) categoryData.rebate = parseFloat(formData[`${category}_rebate`]);
            if (formData[`${category}_discount`]) categoryData.discount = parseFloat(formData[`${category}_discount`]);
            if (formData[`${category}_dispensing_fee`]) categoryData.dispensing_fee = parseFloat(formData[`${category}_dispensing_fee`]);
            if (Object.keys(categoryData).length > 0) {
                pricingStructure[category] = categoryData;
            }
        });

        const insertQuery = `
            INSERT INTO application.prism_price_modeling (
                name, pbm_code, client_size, contract_type, pricing_type,
                pricing_structure, description, created_by, is_active, is_baseline
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
            ) RETURNING id
        `;

        const values = [
            formData.model_name,
            formData.pbm_code,
            formData.client_size,
            formData.contract_type,
            formData.pricing_type,
            JSON.stringify(pricingStructure),
            formData.description || null,
            'user', // TODO: Replace with actual user from session
            true, // Default to active
            false // Default to non-baseline
        ];

        const result = await client.query(insertQuery, values);
        return result.rows[0].id;

    } catch (error) {
        console.error('Failed to create price model:', error);
        throw error;
    }
}

// Delete price model (set is_active to false)
async function deletePriceModel(client, modelId) {
    try {
        const deleteQuery = `
            UPDATE application.prism_price_modeling SET
                is_active = false,
                updated_at = CURRENT_TIMESTAMP,
                last_modified_by = $2
            WHERE id = $1 AND is_active = true
        `;

        const result = await client.query(deleteQuery, [modelId, 'user']); // TODO: Replace with actual user from session
        return result.rowCount > 0;

    } catch (error) {
        console.error('Failed to delete price model:', error);
        throw error;
    }
}

// Update existing price model
async function updatePriceModel(client, modelId, formData) {
    try {
        // Build pricing structure (same logic as create)
        const pricingStructure = {};

        // Overall fees
        if (formData.overall_pepm_rebate_credit || formData.overall_pricing_fee || formData.overall_inhouse_pharmacy_fee) {
            pricingStructure.overall_fee_credit = {};
            if (formData.overall_pemp_rebate_credit) pricingStructure.overall_fee_credit.pepm_rebate_credit = parseFloat(formData.overall_pemp_rebate_credit);
            if (formData.overall_pricing_fee) pricingStructure.overall_fee_credit.pricing_fee = parseFloat(formData.overall_pricing_fee);
            if (formData.overall_inhouse_pharmacy_fee) pricingStructure.overall_fee_credit.inhouse_pharmacy_fee = parseFloat(formData.overall_inhouse_pharmacy_fee);
        }

        // Build category structures
        const categories = ['retail', 'retail_90', 'mail', 'specialty_mail'];
        categories.forEach(category => {
            const categoryData = {};

            // Brand data
            const brandData = {};
            if (formData[`${category}_brand_rebate`]) brandData.rebate = parseFloat(formData[`${category}_brand_rebate`]);
            if (formData[`${category}_brand_discount`]) brandData.discount = parseFloat(formData[`${category}_brand_discount`]);
            if (formData[`${category}_brand_dispensing_fee`]) brandData.dispensing_fee = parseFloat(formData[`${category}_brand_dispensing_fee`]);
            if (Object.keys(brandData).length > 0) categoryData.brand = brandData;

            // Generic data
            const genericData = {};
            if (formData[`${category}_generic_rebate`]) genericData.rebate = parseFloat(formData[`${category}_generic_rebate`]);
            if (formData[`${category}_generic_discount`]) genericData.discount = parseFloat(formData[`${category}_generic_discount`]);
            if (formData[`${category}_generic_dispensing_fee`]) genericData.dispensing_fee = parseFloat(formData[`${category}_generic_dispensing_fee`]);
            if (Object.keys(genericData).length > 0) categoryData.generic = genericData;

            if (Object.keys(categoryData).length > 0) {
                pricingStructure[category] = categoryData;
            }
        });

        // Blended specialty categories
        ['ldd_blended_specialty', 'non_ldd_blended_specialty'].forEach(category => {
            const categoryData = {};
            if (formData[`${category}_rebate`]) categoryData.rebate = parseFloat(formData[`${category}_rebate`]);
            if (formData[`${category}_discount`]) categoryData.discount = parseFloat(formData[`${category}_discount`]);
            if (formData[`${category}_dispensing_fee`]) categoryData.dispensing_fee = parseFloat(formData[`${category}_dispensing_fee`]);
            if (Object.keys(categoryData).length > 0) {
                pricingStructure[category] = categoryData;
            }
        });

        const updateQuery = `
            UPDATE application.prism_price_modeling SET
                name = $2,
                pbm_code = $3,
                client_size = $4,
                contract_type = $5,
                pricing_type = $6,
                pricing_structure = $7,
                description = $8,
                is_active = $9,
                is_baseline = $10,
                updated_at = CURRENT_TIMESTAMP,
                last_modified_by = $11
            WHERE id = $1
        `;

        const values = [
            modelId,
            formData.model_name,
            formData.pbm_code,
            formData.client_size,
            formData.contract_type,
            formData.pricing_type,
            JSON.stringify(pricingStructure),
            formData.description || null,
            formData.is_active === '1',
            formData.is_baseline === '1',
            'user' // TODO: Replace with actual user from session
        ];

        const result = await client.query(updateQuery, values);
        return result.rowCount > 0;

    } catch (error) {
        console.error('Failed to update price model:', error);
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

        // Handle add model form
        if (queryParams.component === 'add') {
            console.log('➕ Loading add model form...');
            const addHTML = await generateAddModelHTML(client);

            return {
                statusCode: 200,
                headers,
                body: addHTML
            };
        }

        // Handle edit model form
        if (queryParams.component === 'edit' && queryParams.id) {
            console.log('✏️ Loading edit model form for ID:', queryParams.id);
            const editHTML = await generateEditModelHTML(client, queryParams.id);

            return {
                statusCode: 200,
                headers,
                body: editHTML
            };
        }

        // Handle delete model (POST request without body, just query params)
        if (method === 'POST' && (path.includes('/delete') || queryParams.action === 'delete')) {
            const modelId = queryParams.id;
            console.log('🗑️ Deleting price model:', modelId);
            try {
                const success = await deletePriceModel(client, modelId);
                if (success) {
                    console.log('✅ Deleted model:', modelId);
                    return {
                        statusCode: 200,
                        headers,
                        body: '<div class="text-green-600">Price model deleted successfully!</div>'
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

        // Handle POST requests for creating/updating models
        if (method === 'POST' && event.body) {
            const params = new URLSearchParams(event.body);
            const formData = {};
            for (const [key, value] of params) {
                formData[key] = value;
            }
            console.log('Form data received:', Object.keys(formData));

            // Handle create model
            if (path.includes('/create') || queryParams.action === 'create') {
                console.log('🆕 Creating new price model...');
                try {
                    const modelId = await createPriceModel(client, formData);
                    console.log('✅ Created model with ID:', modelId);

                    return {
                        statusCode: 200,
                        headers: { ...headers, 'HX-Redirect': '/price-models' },
                        body: '<div class="text-green-600">Price model created successfully!</div>'
                    };
                } catch (error) {
                    return {
                        statusCode: 400,
                        headers,
                        body: `<div class="text-red-600">Error creating model: ${error.message}</div>`
                    };
                }
            }

            // Handle update model
            if (path.includes('/update') || queryParams.action === 'update') {
                const modelId = formData.model_id || queryParams.id;
                console.log('🔄 Updating price model:', modelId);
                try {
                    const success = await updatePriceModel(client, modelId, formData);
                    if (success) {
                        console.log('✅ Updated model:', modelId);
                        return {
                            statusCode: 200,
                            headers: { ...headers, 'HX-Redirect': '/price-models' },
                            body: '<div class="text-green-600">Price model updated successfully!</div>'
                        };
                    } else {
                        throw new Error('Model not found or no changes made');
                    }
                } catch (error) {
                    return {
                        statusCode: 400,
                        headers,
                        body: `<div class="text-red-600">Error updating model: ${error.message}</div>`
                    };
                }
            }


            // Handle filter requests (existing functionality)
            console.log('📊 Loading price models with filters...');
            let filters = {};
            for (const [key, value] of params) {
                filters[key] = value;
            }
            console.log('Filters from POST body:', filters);

            const models = await getPriceModels(client, filters);
            const modelsHTML = await generatePriceModelsHTML(client, models);

            return {
                statusCode: 200,
                headers,
                body: modelsHTML
            };
        }

        // Handle GET requests for price models list
        if (method === 'GET') {
            console.log('📊 Loading price models...');

            let filters = {};
            if (queryParams) {
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

exports.handler = handler;