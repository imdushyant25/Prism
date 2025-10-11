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

// Helper function to render parameter field based on field_type
function renderParameterField(param, fieldName, currentValue, cssClasses) {
    const validationRules = typeof param.validation_rules === 'string'
        ? JSON.parse(param.validation_rules)
        : param.validation_rules || {};

    const fieldType = validationRules.field_type || 'dropdown';
    const paramLabel = param.parameter_name;
    const required = validationRules.required ? 'required' : '';
    const dependsOn = param.depends_on || '';
    const dependsOnAttr = dependsOn ? `data-depends-on="${dependsOn}"` : '';

    if (fieldType === 'dropdown' && param.valid_values && param.valid_values.length > 0) {
        // Dropdown field
        const options = param.valid_values.map(val =>
            `<option value="${val.code}" ${currentValue === val.code ? 'selected' : ''}>${val.label}</option>`
        ).join('');

        return `
            <div ${dependsOnAttr}>
                <label class="block text-sm font-medium text-gray-700 mb-1">${paramLabel}</label>
                <select name="${fieldName}" ${required} class="${cssClasses}">
                    <option value="">Select ${paramLabel}</option>
                    ${options}
                </select>
            </div>
        `;
    } else if (fieldType === 'text') {
        // Text input
        const maxLength = validationRules.max_length || '';
        const maxLengthAttr = maxLength ? `maxlength="${maxLength}"` : '';

        return `
            <div ${dependsOnAttr}>
                <label class="block text-sm font-medium text-gray-700 mb-1">${paramLabel}</label>
                <input type="text" name="${fieldName}" value="${currentValue || ''}" ${required} ${maxLengthAttr}
                       class="${cssClasses}" placeholder="Enter ${paramLabel}">
            </div>
        `;
    } else if (fieldType === 'textarea') {
        // Textarea
        const maxLength = validationRules.max_length || '';
        const maxLengthAttr = maxLength ? `maxlength="${maxLength}"` : '';

        return `
            <div ${dependsOnAttr}>
                <label class="block text-sm font-medium text-gray-700 mb-1">${paramLabel}</label>
                <textarea name="${fieldName}" ${required} ${maxLengthAttr} rows="3"
                          class="${cssClasses}" placeholder="Enter ${paramLabel}">${currentValue || ''}</textarea>
            </div>
        `;
    } else if (fieldType === 'number') {
        // Number input
        return `
            <div ${dependsOnAttr}>
                <label class="block text-sm font-medium text-gray-700 mb-1">${paramLabel}</label>
                <input type="number" name="${fieldName}" value="${currentValue || ''}" ${required}
                       class="${cssClasses}" placeholder="Enter ${paramLabel}">
            </div>
        `;
    }

    // Fallback for unknown types
    return '';
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
                parent.special_ui_render,
                parent.validation_rules,
                parent.depends_on,
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
                parent.special_ui_render,
                parent.validation_rules,
                parent.depends_on,
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

// Get pricing structure definition from system config
async function getPricingStructure(client) {
    try {
        const query = `
            WITH RECURSIVE
            -- Get all categories
            categories AS (
                SELECT
                    config_code,
                    display_name,
                    display_order,
                    description
                FROM application.prism_system_config
                WHERE config_type = 'pricing_category'
                  AND is_active = true
            ),
            -- Get all subcategories with their parent category
            subcategories AS (
                SELECT
                    sub.config_code,
                    sub.display_name,
                    sub.parent_code,
                    sub.display_order
                FROM application.prism_system_config sub
                WHERE sub.config_type = 'pricing_subcategory'
                  AND sub.is_active = true
            ),
            -- Get all fields with their aggregated structure
            subcategory_fields AS (
                SELECT
                    sub.parent_code as category_code,
                    sub.config_code as subcategory_code,
                    sub.display_name as subcategory_name,
                    sub.display_order as subcategory_order,
                    json_agg(
                        json_build_object(
                            'field_code', field.config_code,
                            'field_name', field.display_name,
                            'field_order', field.display_order,
                            'validation', field.validation_rules
                        ) ORDER BY field.display_order
                    ) as fields
                FROM subcategories sub
                INNER JOIN application.prism_system_config field
                    ON field.parent_code = sub.config_code
                    AND field.config_type = 'pricing_field'
                    AND field.is_active = true
                GROUP BY sub.parent_code, sub.config_code, sub.display_name, sub.display_order
            ),
            -- Get fields directly under categories (no subcategory)
            category_fields AS (
                SELECT
                    cat.config_code as category_code,
                    NULL::text as subcategory_code,
                    NULL::text as subcategory_name,
                    0 as subcategory_order,
                    json_agg(
                        json_build_object(
                            'field_code', field.config_code,
                            'field_name', field.display_name,
                            'field_order', field.display_order,
                            'validation', field.validation_rules
                        ) ORDER BY field.display_order
                    ) as fields
                FROM categories cat
                INNER JOIN application.prism_system_config field
                    ON field.parent_code = cat.config_code
                    AND field.config_type = 'pricing_field'
                    AND field.is_active = true
                WHERE NOT EXISTS (
                    SELECT 1 FROM subcategories sub
                    WHERE sub.parent_code = cat.config_code
                )
                GROUP BY cat.config_code
            ),
            -- Combine subcategory and category fields
            all_structures AS (
                SELECT * FROM subcategory_fields
                UNION ALL
                SELECT * FROM category_fields
            )
            -- Final aggregation by category
            SELECT
                cat.config_code as category_code,
                cat.display_name as category_name,
                cat.display_order as category_order,
                cat.description as category_description,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'subcategory_code', st.subcategory_code,
                            'subcategory_name', st.subcategory_name,
                            'fields', st.fields
                        ) ORDER BY st.subcategory_order
                    ) FILTER (WHERE st.subcategory_code IS NOT NULL OR st.fields IS NOT NULL),
                    '[]'::json
                ) as structure
            FROM categories cat
            LEFT JOIN all_structures st ON st.category_code = cat.config_code
            GROUP BY cat.config_code, cat.display_name, cat.display_order, cat.description
            ORDER BY cat.display_order
        `;

        const result = await client.query(query);
        return result.rows;
    } catch (error) {
        console.error('Error getting pricing structure:', error);
        return [];
    }
}

// Generate pricing form HTML from pricing structure
function generatePricingFormHTML(pricingStructure, currentValues = {}) {
    let html = '';

    // Helper to safely get nested values
    const getValue = (categoryCode, subcategoryCode, fieldCode) => {
        if (subcategoryCode) {
            return currentValues[categoryCode]?.[subcategoryCode]?.[fieldCode] || '';
        }
        return currentValues[categoryCode]?.[fieldCode] || '';
    };

    // Helper to generate field name
    const getFieldName = (categoryCode, subcategoryCode, fieldCode) => {
        if (subcategoryCode) {
            return `${categoryCode}_${subcategoryCode}_${fieldCode}`;
        }
        return `${categoryCode}_${fieldCode}`;
    };

    pricingStructure.forEach(category => {
        const structure = category.structure || [];

        // Check if category has subcategories
        const hasSubcategories = structure.some(item => item.subcategory_code !== null);

        html += `
            <!-- ${category.category_name} -->
            <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
                <h3 class="text-lg font-semibold text-gray-900 mb-4">${category.category_name}</h3>
        `;

        if (hasSubcategories) {
            // Category with subcategories (e.g., Retail: Brand/Generic)
            html += '<div class="border border-gray-200 rounded-lg p-6">';
            html += '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">';

            structure.forEach(subcat => {
                if (!subcat.subcategory_code || !subcat.fields || !Array.isArray(subcat.fields)) return;

                html += `
                    <div>
                        <h5 class="text-sm font-medium text-gray-700 mb-3">${subcat.subcategory_name}</h5>
                        <div class="grid grid-cols-${subcat.fields.length} gap-3">
                `;

                subcat.fields.forEach(field => {
                    const fieldName = getFieldName(category.category_code, subcat.subcategory_code, field.field_code);
                    const fieldValue = getValue(category.category_code, subcat.subcategory_code, field.field_code);

                    html += `
                        <div>
                            <label class="block text-xs text-gray-600 mb-1">${field.field_name}</label>
                            <input type="number" step="0.01" name="${fieldName}" value="${fieldValue}"
                                   class="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500">
                        </div>
                    `;
                });

                html += `
                        </div>
                    </div>
                `;
            });

            html += '</div></div>';
        } else {
            // Category without subcategories (e.g., Overall Fees, LDD Blended Specialty)
            const fields = structure[0]?.fields || [];

            if (Array.isArray(fields) && fields.length > 0) {
                html += `<div class="grid grid-cols-${Math.min(fields.length, 3)} gap-6">`;

                fields.forEach(field => {
                    const fieldName = getFieldName(category.category_code, null, field.field_code);
                    const fieldValue = getValue(category.category_code, null, field.field_code);

                    html += `
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">${field.field_name}</label>
                            <input type="number" step="0.01" name="${fieldName}" value="${fieldValue}"
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                    `;
                });

                html += '</div>';
            }
        }

        html += `
            </div>
        `;
    });

    return html;
}

// Build pricing structure from form data dynamically
function buildPricingStructureFromForm(formData, pricingStructure) {
    const result = {};

    pricingStructure.forEach(category => {
        const categoryCode = category.category_code;
        const structure = category.structure || [];

        // Check if category has subcategories
        const hasSubcategories = structure.some(item => item.subcategory_code !== null);

        if (hasSubcategories) {
            // Category with subcategories
            result[categoryCode] = {};

            structure.forEach(subcat => {
                if (!subcat.subcategory_code || !subcat.fields) return;

                const subcategoryCode = subcat.subcategory_code;
                result[categoryCode][subcategoryCode] = {};

                subcat.fields.forEach(field => {
                    const fieldName = `${categoryCode}_${subcategoryCode}_${field.field_code}`;
                    const value = formData[fieldName];
                    result[categoryCode][subcategoryCode][field.field_code] = value ? parseFloat(value) : null;
                });
            });
        } else {
            // Category without subcategories
            result[categoryCode] = {};
            const fields = structure[0]?.fields || [];

            fields.forEach(field => {
                const fieldName = `${categoryCode}_${field.field_code}`;
                const value = formData[fieldName];
                result[categoryCode][field.field_code] = value ? parseFloat(value) : null;
            });
        }
    });

    return result;
}

// Generate pricing display HTML for table listing (dynamic)
function generatePricingDisplayHTML(pricingStructure, pricingData) {
    const parts = [];

    if (!pricingData || Object.keys(pricingData).length === 0) {
        return '• No pricing structure specified';
    }

    pricingStructure.forEach(category => {
        const categoryCode = category.category_code;
        const categoryName = category.category_name;
        const categoryData = pricingData[categoryCode];

        if (!categoryData) return;

        const structure = category.structure || [];
        const hasSubcategories = structure.some(item => item.subcategory_code !== null);

        if (hasSubcategories) {
            // Category with subcategories (e.g., Retail: Brand/Generic)
            const subParts = [];

            structure.forEach(subcat => {
                if (!subcat.subcategory_code || !subcat.fields) return;

                const subcategoryCode = subcat.subcategory_code;
                const subcategoryName = subcat.subcategory_name;
                const subcategoryData = categoryData[subcategoryCode];

                if (!subcategoryData) return;

                subcat.fields.forEach(field => {
                    const fieldCode = field.field_code;
                    const fieldName = field.field_name;
                    const fieldValue = subcategoryData[fieldCode];

                    if (fieldValue !== null && fieldValue !== undefined) {
                        // Format based on field type ($ or %)
                        const formattedValue = fieldName.includes('%') || fieldName.toLowerCase().includes('discount')
                            ? `${fieldValue}%`
                            : `$${fieldValue}`;

                        subParts.push(`${subcategoryName} ${fieldName.replace(/\s*\(\$\)|\s*\(%\)/g, '')}: ${formattedValue}`);
                    }
                });
            });

            if (subParts.length > 0) {
                parts.push(`<strong>${categoryName}:</strong> ${subParts.join(', ')}`);
            }
        } else {
            // Category without subcategories (e.g., Overall Fees & Credits)
            const fieldParts = [];
            const fields = structure[0]?.fields || [];

            fields.forEach(field => {
                const fieldCode = field.field_code;
                const fieldName = field.field_name;
                const fieldValue = categoryData[fieldCode];

                if (fieldValue !== null && fieldValue !== undefined) {
                    // Format based on field type ($ or %)
                    const formattedValue = fieldName.includes('%') || fieldName.toLowerCase().includes('discount')
                        ? `${fieldValue}%`
                        : `$${fieldValue}`;

                    fieldParts.push(`${fieldName.replace(/\s*\(\$\)|\s*\(%\)/g, '')}: ${formattedValue}`);
                }
            });

            if (fieldParts.length > 0) {
                parts.push(`<strong>${categoryName}:</strong> ${fieldParts.join(', ')}`);
            }
        }
    });

    return parts.length > 0
        ? parts.map(p => `• ${p}`).join('<br>')
        : '• No pricing structure specified';
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

        // Generate config type options with selection
        const configTypeOptions = [
            `<option value="PRODUCTION" ${config.config_type === 'PRODUCTION' ? 'selected' : ''}>Production</option>`,
            `<option value="MODELING" ${config.config_type === 'MODELING' ? 'selected' : ''}>Modeling</option>`
        ].join('');

        // Get all parameters for this PBM
        const allParameters = await getAdditionalParameters(client, config.pbm_code);

        // Separate parameters based on special_ui_render flag
        const basicInfoParams = allParameters.filter(p => p.special_ui_render === true);
        const additionalParams = allParameters.filter(p => p.special_ui_render !== true);

        // Generate Basic Info parameter fields (special_ui_render = true)
        let basicInfoFieldsHTML = '';
        basicInfoParams.forEach(param => {
            const currentValue = config[param.parameter_code] || additionalParameters[param.parameter_code] || '';
            const cssClasses = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500';
            basicInfoFieldsHTML += renderParameterField(param, param.parameter_code, currentValue, cssClasses);
        });

        // Generate Additional Parameters fields (special_ui_render = false or null)
        let additionalParamsHTML = '';
        if (additionalParams.length > 0) {
            additionalParamsHTML = additionalParams.map(param => {
                const currentValue = additionalParameters[param.parameter_code] || '';
                const cssClasses = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500';
                return renderParameterField(param, `param_${param.parameter_code}`, currentValue, cssClasses);
            }).join('');
        } else {
            additionalParamsHTML = '<p class="text-sm text-gray-500">No additional parameters available for this PBM.</p>';
        }

        // Format dates for input fields (YYYY-MM-DD)
        const formatDateForInput = (dateStr) => {
            if (!dateStr) return '';
            const date = new Date(dateStr);
            return date.toISOString().split('T')[0];
        };

        // Get dynamic pricing structure from system config
        const pricingStructureDefinition = await getPricingStructure(client);

        // Generate pricing form HTML with current values
        const pricingFormHTML = generatePricingFormHTML(pricingStructureDefinition, pricingStructure);

        const editData = {
            CONFIG_ID: config.config_id,
            NAME: config.name,
            DESCRIPTION: config.description || '',
            PBM_CODE: config.pbm_code,
            CONFIG_TYPE_OPTIONS: configTypeOptions,
            EFFECTIVE_FROM: formatDateForInput(config.effective_from),
            EFFECTIVE_TO: formatDateForInput(config.effective_to),
            BASIC_INFO_FIELDS: basicInfoFieldsHTML,
            ADDITIONAL_PARAMETERS_FIELDS: additionalParamsHTML,
            PRICING_STRUCTURE_FIELDS: pricingFormHTML
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

        // Get dynamic pricing structure definition from system config
        const pricingStructureDefinition = await getPricingStructure(dbClient);

        // Build pricing structure dynamically from form data
        const pricingStructure = buildPricingStructureFromForm(formData, pricingStructureDefinition);

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

        // Get dynamic pricing structure definition from system config
        const pricingStructureDefinition = await getPricingStructure(dbClient);

        // Build pricing structure dynamically from form data
        const pricingStructure = buildPricingStructureFromForm(formData, pricingStructureDefinition);

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

            // Get dynamic pricing structure from system config
            const pricingStructureDefinition = await getPricingStructure(client);

            // Generate pricing form HTML with empty values
            const pricingFormHTML = generatePricingFormHTML(pricingStructureDefinition, {});

            await client.end();

            const modalHTML = renderTemplate(addModalTemplate, {
                PBM_OPTIONS: pbmOptions,
                PRICING_STRUCTURE_FIELDS: pricingFormHTML
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

        // Get pricing structure definition for display
        const pricingStructureDefinition = await getPricingStructure(client);

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

            // Build price structure display dynamically
            let priceStructureDisplay = '• No pricing structure specified';
            if (config.pricing_structure) {
                try {
                    const pricing = typeof config.pricing_structure === 'string'
                        ? JSON.parse(config.pricing_structure)
                        : config.pricing_structure;

                    console.log('Pricing structure for', config.name, ':', JSON.stringify(pricing));

                    // Use dynamic function to generate pricing display
                    priceStructureDisplay = generatePricingDisplayHTML(pricingStructureDefinition, pricing);
                } catch (e) {
                    console.error('Error parsing pricing structure for', config.name, ':', e);
                }
            }

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
