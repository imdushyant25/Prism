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
        // Handle null/undefined values gracefully
        return value !== undefined && value !== null ? String(value) : '';
    });
}

// Generate filters HTML with options from prism_source_config
async function generateFiltersHTML(client) {
    try {
        const filtersTemplate = await getTemplate('filters.html');

        // Get all dropdown options from config
        const configQuery = `
            SELECT config_type, config_code, display_name
            FROM application.prism_system_config
            WHERE config_type IN ('rule_type', 'rule_category', 'data_source', 'pbm')
              AND is_active = true
            ORDER BY config_type, display_order
        `;

        const configResult = await client.query(configQuery);
        const configData = {};

        // Group config data by type
        configResult.rows.forEach(row => {
            if (!configData[row.config_type]) {
                configData[row.config_type] = [];
            }
            configData[row.config_type].push({
                code: row.config_code,
                name: row.display_name
            });
        });

        // Prepare data object
        const data = {
            pbm_codes: configData.pbm || [],
            rule_types: configData.rule_type || [],
            rule_categories: configData.rule_category || [],
            data_sources: configData.data_source || []
        };

        // Build HTML options for each dropdown
        const pbmOptions = (data.pbm_codes || [])
            .map((pbm, index) => `<option value="${pbm.code}" ${index === 0 ? 'selected' : ''}>${pbm.name}</option>`)
            .join('');
            
        const ruleTypeOptions = (data.rule_types || [])
            .map(type => `<option value="${type.code}">${type.name}</option>`)
            .join('');

        const categoryOptions = (data.rule_categories || [])
            .map(cat => `<option value="${cat.code}">${cat.name}</option>`)
            .join('');

        const dataSourceOptions = (data.data_sources || [])
            .map(source => `<option value="${source.code}">${source.name}</option>`)
            .join('');
        
        // Status options are still hardcoded since they're UI concepts, not data
        const statusOptions = [
            '<option value="active">Active</option>',
            '<option value="inactive">Inactive</option>'
        ].join('');
        
        // Render template with dynamic data
        const filterData = {
            PBM_OPTIONS: pbmOptions,
            RULE_TYPE_OPTIONS: ruleTypeOptions,
            CATEGORY_OPTIONS: categoryOptions,
            DATA_SOURCE_OPTIONS: dataSourceOptions,
            STATUS_OPTIONS: statusOptions
        };

        return renderTemplate(filtersTemplate, filterData);
        
    } catch (error) {
        console.error('Error generating filters:', error);
        return '<div class="text-red-500">Error loading filters</div>';
    }
}

// Build focused filter query based on the 6 filters we chose
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
    
    // Always add these base conditions
    addCondition('pbm_code = ?', hasValue(filters.pbm_filter) ? filters.pbm_filter : 'CVS');
    addCondition('is_active = ?', filters.status_filter === 'inactive' ? false : true);
    addCondition('rule_category = ?', hasValue(filters.category_filter) ? filters.category_filter : 'PRODUCTION');
    
    // Optional filters
    if (hasValue(filters.rule_type_filter)) {
        addCondition('rule_type = ?', filters.rule_type_filter);
    }
    
    if (hasValue(filters.data_source_filter)) {
        addCondition('data_source = ?', filters.data_source_filter);
    }
    
    if (hasValue(filters.name_search)) {
        addCondition('LOWER(name) LIKE LOWER(?)', `%${filters.name_search.trim()}%`);
    }
    
    return {
        whereClause: conditions.join(' AND '),
        params,
        pbmCode: hasValue(filters.pbm_filter) ? filters.pbm_filter : 'CVS'
    };
}

// function to get available flags for complex rules
async function getAvailableFlags(client, currentRuleId = null) {
    try {
        const flagsQuery = `
            SELECT DISTINCT flag_name, rule_type, pbm_code, name
            FROM application.prism_enrichment_rules 
            WHERE is_active = true 
            ${currentRuleId ? 'AND rule_id != $1' : ''}
            ORDER BY pbm_code, rule_type, flag_name
        `;
        
        const params = currentRuleId ? [currentRuleId] : [];
        const result = await client.query(flagsQuery, params);
        
        return result.rows.map(row => ({
            flag_name: row.flag_name,
            rule_type: row.rule_type,
            pbm_code: row.pbm_code,
            name: row.name
        }));
    } catch (error) {
        console.error('Error getting available flags:', error);
        return [];
    }
}

async function getFieldsByDataSource(client, dataSource = null) {
    try {
        let fieldsQuery = `
            SELECT 
                business_name, 
                technical_name, 
                data_source, 
                field_type,
                field_group,
                help_text,
                allowed_values
            FROM application.prism_field_registry 
            WHERE is_searchable = true
        `;
        
        const params = [];
        
        // If specific data source requested, filter by it
        if (dataSource && dataSource.trim()) {
            fieldsQuery += ` AND LOWER(data_source) = LOWER($1)`;
            params.push(dataSource.trim());
        }
        
        fieldsQuery += ` ORDER BY field_group, sort_order, business_name`;
        
        const fieldsResult = await client.query(fieldsQuery, params);
        console.log(`✅ Fields fetched for data source '${dataSource}':`, fieldsResult.rows.length, 'fields');
        
        return fieldsResult.rows;
    } catch (error) {
        console.error('Error getting fields by data source:', error);
        return [];
    }
}

// Handle GET request for edit modal
async function getEditRuleModal(client, ruleId) {
    try {
        console.log('📋 Loading edit modal template...');
        const editModalTemplate = await getTemplate('edit-rule-modal.html');
        console.log('✅ Template loaded, length:', editModalTemplate.length);
        
        // Get the rule data
        console.log('🔍 Fetching rule data for:', ruleId);
        const ruleQuery = `
            SELECT * FROM application.prism_enrichment_rules 
            WHERE rule_id = $1 AND is_active = true
        `;
        
        const ruleResult = await client.query(ruleQuery, [ruleId]);
        if (ruleResult.rows.length === 0) {
            throw new Error('Rule not found');
        }
        
        const rule = ruleResult.rows[0];
        console.log('✅ Rule found:', rule.name, 'Type:', rule.rule_type, 'Data Source:', rule.data_source);
        
        // Get dropdown options - PBM from actual data, others from config
        console.log('🔍 Fetching dropdown options...');

        // Get all dropdown options from config
        const configQuery = `
            SELECT config_type, config_code, display_name
            FROM application.prism_system_config
            WHERE config_type IN ('pbm', 'data_source') AND is_active = true
            ORDER BY config_type, display_order
        `;
        const configResult = await client.query(configQuery);

        const configData = {};
        configResult.rows.forEach(row => {
            if (!configData[row.config_type]) {
                configData[row.config_type] = [];
            }
            configData[row.config_type].push({
                code: row.config_code,
                name: row.display_name
            });
        });

        const pbmCodes = configData.pbm || [];
        const dataSources = configData.data_source || [];

        console.log('✅ Options fetched - PBMs:', pbmCodes.length, 'Sources:', dataSources.length);
        
        // FIXED: Get fields specific to current rule's data source (if it's a simple rule)
        let fieldsData = [];
        if (rule.rule_type === 'SIMPLE' && rule.data_source) {
            fieldsData = await getFieldsByDataSource(client, rule.data_source);
        } else {
            // For COMPLEX rules, get all fields but grouped by data source
            fieldsData = await getFieldsByDataSource(client);
        }
        
        console.log('✅ Fields fetched:', fieldsData.length, 'fields for data source:', rule.data_source);
        
        // **Get available flags for complex rules**
        console.log('🏷️ Fetching available flags...');
        const availableFlags = await getAvailableFlags(client, ruleId);
        console.log('✅ Available flags fetched:', availableFlags.length, 'flags');
        
        // Build dropdown options
        console.log('🔨 Building dropdown options...');
        const pbmOptions = pbmCodes
            .map(pbm => `<option value="${pbm.code}" ${pbm.code === rule.pbm_code ? 'selected' : ''}>${pbm.name}</option>`)
            .join('');

        const dataSourceOptions = dataSources
            .map(source => `<option value="${source.code}" ${source.code === rule.data_source ? 'selected' : ''}>${source.name}</option>`)
            .join('');
            
        // FIXED: Build field options properly with current data source filtering
        const fieldOptions = fieldsData
            .map(field => {
                const displayName = field.business_name;
                const helpText = field.help_text ? ` - ${field.help_text}` : '';
                return `<option value="${field.technical_name}" 
                               data-source="${field.data_source}" 
                               data-type="${field.field_type}"
                               data-group="${field.field_group || ''}"
                               title="${displayName}${helpText}">
                    ${displayName}
                </option>`;
            })
            .join('');
        
        // **Build available flags options for complex rules**
        const availableFlagsOptions = availableFlags
            .map(flag => {
                const displayName = `${flag.flag_name} (${flag.pbm_code} - ${flag.name})`;
                return `<option value="${flag.flag_name}" data-type="${flag.rule_type}" data-pbm="${flag.pbm_code}">${displayName}</option>`;
            })
            .join('');
        
        console.log('🎯 Generated', fieldsData.length, 'field options for data source:', rule.data_source);
        
        // FIXED: Parse eligibility types properly as array
        let eligibilityTypes = [];
        try {
            const eligibilityData = rule.eligibility_types;
            if (typeof eligibilityData === 'string') {
                eligibilityTypes = JSON.parse(eligibilityData);
            } else if (Array.isArray(eligibilityData)) {
                eligibilityTypes = eligibilityData;
            } else {
                eligibilityTypes = ['REBATE_ELIGIBLE']; // Default
            }
        } catch (e) {
            console.warn('Failed to parse eligibility types:', e);
            eligibilityTypes = ['REBATE_ELIGIBLE'];
        }
        console.log('✅ Eligibility types parsed:', eligibilityTypes);
        
        // FIXED: Build eligibility options as multi-select with proper defaults
        const eligibilityOptions = [
            { value: 'REBATE_ELIGIBLE', label: 'Rebate Eligible' },
            { value: 'REBATE_INELIGIBLE', label: 'Rebate Ineligible' },
            { value: 'DISCOUNT_ELIGIBLE', label: 'Discount Eligible' },
            { value: 'DISCOUNT_INELIGIBLE', label: 'Discount Ineligible' }
        ];
        
        const eligibilityHTML = eligibilityOptions
            .map(option => {
                const isSelected = eligibilityTypes.includes(option.value);
                return `<option value="${option.value}" ${isSelected ? 'selected' : ''}>${option.label}</option>`;
            })
            .join('');

        // **Build template data with enhanced field filtering**
        const templateData = {
            RULE_ID: rule.rule_id,
            RULE_NAME: rule.name,
            RULE_TYPE: rule.rule_type,
            VERSION: rule.version,
            NEXT_VERSION: rule.version + 1,
            CONDITIONS: rule.conditions || '',
            FLAG_NAME: rule.flag_name,
            DATA_SOURCE: rule.data_source || '',
            PRIORITY: rule.priority,

            // Effective dates
            EFFECTIVE_FROM: rule.effective_from ? new Date(rule.effective_from).toISOString().split('T')[0] : '',
            EFFECTIVE_TO: rule.effective_to ? new Date(rule.effective_to).toISOString().split('T')[0] : '',

            // Dropdown options
            PBM_OPTIONS: pbmOptions,
            DATA_SOURCE_OPTIONS: dataSourceOptions,
            DATASOURCE_FIELDS: fieldOptions,  // FIXED: Now properly filtered
            AVAILABLE_FLAGS: availableFlagsOptions,
            ELIGIBILITY_OPTIONS: eligibilityHTML,

            // Selected states for dropdowns
            SIMPLE_SELECTED: rule.rule_type === 'SIMPLE' ? 'selected' : '',
            COMPLEX_SELECTED: rule.rule_type === 'COMPLEX' ? 'selected' : '',
            CLIENT_SELECTED: rule.rule_type === 'CLIENT' ? 'selected' : '',

            PRODUCTION_SELECTED: rule.rule_category === 'PRODUCTION' ? 'selected' : '',
            MODELING_SELECTED: rule.rule_category === 'MODELING' ? 'selected' : '',

            // Checkboxes
            STANDALONE_CHECKED: rule.is_standalone_executable ? 'checked' : '',
            ACTIVE_CHECKED: rule.is_active ? 'checked' : ''
        };
        
        console.log('🎯 Template data prepared with:');
        console.log('  - Data source:', templateData.DATA_SOURCE);
        console.log('  - Field options count:', fieldsData.length);
        console.log('  - Eligibility types:', eligibilityTypes);
        
        if (fieldsData.length === 0) {
            console.warn('⚠️ WARNING: No fields found for data source:', rule.data_source);
        }
        
        console.log('🔨 Rendering template...');
        const result = renderTemplate(editModalTemplate, templateData);
        console.log('✅ Template rendered successfully, final length:', result.length);
        
        return result;
        
    } catch (error) {
        console.error('❌ Error in getEditRuleModal:', error);
        console.error('❌ Error stack:', error.stack);
        throw error;
    }
}

// Handle GET request for add modal
async function getAddRuleModal(client) {
    try {
        console.log('➕ Loading add modal template...');
        const addModalTemplate = await getTemplate('add-rule-modal.html');
        console.log('✅ Template loaded, length:', addModalTemplate.length);

        // Get dropdown options - PBM from actual data, others from config
        console.log('🔍 Fetching dropdown options...');

        // Get all dropdown options from config
        const configQuery = `
            SELECT config_type, config_code, display_name
            FROM application.prism_system_config
            WHERE config_type IN ('pbm', 'data_source') AND is_active = true
            ORDER BY config_type, display_order
        `;
        const configResult = await client.query(configQuery);

        const configData = {};
        configResult.rows.forEach(row => {
            if (!configData[row.config_type]) {
                configData[row.config_type] = [];
            }
            configData[row.config_type].push({
                code: row.config_code,
                name: row.display_name
            });
        });

        const pbmCodes = configData.pbm || [];
        const dataSources = configData.data_source || [];

        console.log('✅ Options fetched - PBMs:', pbmCodes.length, 'Sources:', dataSources.length);

        // Build dropdown HTML
        const pbmOptions = pbmCodes
            .map(pbm => `<option value="${pbm.code}">${pbm.name}</option>`)
            .join('');

        const dataSourceOptions = '<option value="">Select Data Source</option>' +
            dataSources
                .map(source => `<option value="${source.code}">${source.name}</option>`)
                .join('');

        // Get available flags for complex rules
        const availableFlags = await getAvailableFlags(client, null);
        const flagOptions = availableFlags
            .map(flag => `<option value="${flag.flag_name}" data-rule-type="${flag.rule_type}" data-pbm="${flag.pbm_code}">${flag.flag_name} (${flag.rule_type} - ${flag.pbm_code})</option>`)
            .join('');

        // Template data for add modal
        const templateData = {
            PBM_OPTIONS: pbmOptions,
            DATA_SOURCE_OPTIONS: dataSourceOptions,
            AVAILABLE_FLAGS: flagOptions,
            DATASOURCE_FIELDS: '<option value="">Select data source first</option>'
        };

        console.log('🔨 Rendering add template...');
        const result = renderTemplate(addModalTemplate, templateData);
        console.log('✅ Add template rendered successfully, final length:', result.length);

        return result;

    } catch (error) {
        console.error('❌ Error in getAddRuleModal:', error);
        throw error;
    }
}

// Handle GET request for clone modal
async function getCloneRuleModal(client, ruleId) {
    try {
        console.log('📋 Loading clone modal template...');
        const addModalTemplate = await getTemplate('add-rule-modal.html');
        console.log('✅ Template loaded, length:', addModalTemplate.length);

        // Get the source rule data
        const ruleQuery = `
            SELECT * FROM application.prism_enrichment_rules
            WHERE rule_id = $1 AND is_active = true
        `;

        const ruleResult = await client.query(ruleQuery, [ruleId]);
        if (ruleResult.rows.length === 0) {
            throw new Error('Source rule not found');
        }

        const rule = ruleResult.rows[0];
        console.log('✅ Source rule found:', rule.name);

        // Get all dropdown options from config
        const configQuery = `
            SELECT config_type, config_code, display_name
            FROM application.prism_system_config
            WHERE config_type IN ('pbm', 'data_source') AND is_active = true
            ORDER BY config_type, display_order
        `;
        const configResult = await client.query(configQuery);

        const configData = {};
        configResult.rows.forEach(row => {
            if (!configData[row.config_type]) {
                configData[row.config_type] = [];
            }
            configData[row.config_type].push({
                code: row.config_code,
                name: row.display_name
            });
        });

        const pbmCodes = configData.pbm || [];
        const dataSources = configData.data_source || [];

        // Build dropdown HTML with selections
        const pbmOptions = pbmCodes
            .map(pbm => `<option value="${pbm.code}" ${pbm.code === rule.pbm_code ? 'selected' : ''}>${pbm.name}</option>`)
            .join('');

        const dataSourceOptions = '<option value="">Select Data Source</option>' +
            dataSources
                .map(source => `<option value="${source.code}" ${source.code === rule.data_source ? 'selected' : ''}>${source.name}</option>`)
                .join('');

        // Get available flags for complex rules
        const availableFlags = await getAvailableFlags(client, ruleId);
        const flagOptions = availableFlags
            .map(flag => `<option value="${flag.flag_name}" data-rule-type="${flag.rule_type}" data-pbm="${flag.pbm_code}">${flag.flag_name} (${flag.rule_type} - ${flag.pbm_code})</option>`)
            .join('');

        // Parse eligibility types
        let eligibilityTypes = [];
        try {
            eligibilityTypes = rule.eligibility_types ? JSON.parse(rule.eligibility_types) : ['REBATE_ELIGIBLE'];
        } catch (e) {
            eligibilityTypes = ['REBATE_ELIGIBLE'];
        }

        // Create modified template for cloning
        let modifiedTemplate = addModalTemplate.replace(
            'Add New Enrichment Rule',
            `Clone: ${rule.name}`
        );

        // Modify the form to handle cloning
        modifiedTemplate = modifiedTemplate.replace(
            'hx-post="https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/rules?action=create"',
            'hx-post="https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/rules?action=create"'
        );

        // Template data for clone modal (pre-filled with source rule data)
        const templateData = {
            PBM_OPTIONS: pbmOptions,
            DATA_SOURCE_OPTIONS: dataSourceOptions,
            AVAILABLE_FLAGS: flagOptions,
            DATASOURCE_FIELDS: '<option value="">Select data source first</option>'
        };

        // Pre-fill form values by replacing input/textarea values
        modifiedTemplate = modifiedTemplate.replace(
            'name="rule_name" required',
            `name="rule_name" required value=""`
        );
        modifiedTemplate = modifiedTemplate.replace(
            'name="flag_name" required',
            `name="flag_name" required value="${rule.flag_name || ''}"`
        );
        modifiedTemplate = modifiedTemplate.replace(
            'name="priority" min="1" value="100"',
            `name="priority" min="1" value="${rule.priority || 100}"`
        );

        // Pre-populate effective dates if they exist
        if (rule.effective_from) {
            const effectiveFromDate = new Date(rule.effective_from).toISOString().split('T')[0];
            modifiedTemplate = modifiedTemplate.replace(
                'name="effective_from"',
                `name="effective_from" value="${effectiveFromDate}"`
            );
        }

        if (rule.effective_to) {
            const effectiveToDate = new Date(rule.effective_to).toISOString().split('T')[0];
            modifiedTemplate = modifiedTemplate.replace(
                'name="effective_to"',
                `name="effective_to" value="${effectiveToDate}"`
            );
        }
        // Pre-populate conditions in the hidden textarea (this is used for both simple and complex rules)
        modifiedTemplate = modifiedTemplate.replace(
            'name="conditions" id="conditions-textarea" class="hidden"></textarea>',
            `name="conditions" id="conditions-textarea" class="hidden">${rule.conditions || ''}</textarea>`
        );

        // Also populate any visible condition preview areas
        if (rule.conditions) {
            modifiedTemplate = modifiedTemplate.replace(
                '<!-- SQL preview will be generated here -->',
                rule.conditions
            );
            modifiedTemplate = modifiedTemplate.replace(
                '<!-- SQL preview will be shown here -->',
                rule.conditions
            );
        }

        // Set rule category
        if (rule.rule_category) {
            modifiedTemplate = modifiedTemplate.replace(
                `value="${rule.rule_category}"`,
                `value="${rule.rule_category}" selected`
            );
        }

        // Set rule type and show appropriate section
        if (rule.rule_type) {
            modifiedTemplate = modifiedTemplate.replace(
                `value="${rule.rule_type}"`,
                `value="${rule.rule_type}" selected`
            );

            // Show the correct rule builder section based on rule type
            if (rule.rule_type === 'SIMPLE') {
                modifiedTemplate = modifiedTemplate.replace(
                    'id="simple-section" class="hidden"',
                    'id="simple-section" class=""'
                );
                modifiedTemplate = modifiedTemplate.replace(
                    'id="complex-section" class="hidden"',
                    'id="complex-section" class="hidden"'
                );
            } else if (rule.rule_type === 'COMPLEX') {
                modifiedTemplate = modifiedTemplate.replace(
                    'id="complex-section" class="hidden"',
                    'id="complex-section" class=""'
                );
                modifiedTemplate = modifiedTemplate.replace(
                    'id="simple-section" class="hidden"',
                    'id="simple-section" class="hidden"'
                );
            }
        }

        // Set checkboxes
        if (rule.is_active) {
            modifiedTemplate = modifiedTemplate.replace('name="is_active"', 'name="is_active" checked');
        }
        if (rule.is_standalone_executable) {
            modifiedTemplate = modifiedTemplate.replace('name="is_standalone_executable"', 'name="is_standalone_executable" checked');
        }

        // Set eligibility type checkboxes - need to be more specific to avoid conflicts
        eligibilityTypes.forEach(type => {
            modifiedTemplate = modifiedTemplate.replace(
                `name="eligibility_types" value="${type}"`,
                `name="eligibility_types" value="${type}" checked`
            );
        });

        console.log('🔨 Rendering clone template...');
        const result = renderTemplate(modifiedTemplate, templateData);
        console.log('✅ Clone template rendered successfully');

        return result;

    } catch (error) {
        console.error('❌ Error in getCloneRuleModal:', error);
        throw error;
    }
}

// Handle clone operation
async function cloneRules(client, ruleIds, targetCategory = 'MODELING', overwriteExisting = true) {
    const dbClient = client;
    
    try {
        await dbClient.query('BEGIN');
        
        const clonedRules = [];
        let successCount = 0;
        let errorCount = 0;
        
        console.log(`🔄 Starting clone operation for ${ruleIds.length} rules`);
        
        for (const ruleId of ruleIds) {
            try {
                console.log(`📋 Cloning rule: ${ruleId}`);
                
                // Get the latest active version of the rule
                const sourceRuleQuery = `
                    SELECT * FROM application.prism_enrichment_rules 
                    WHERE rule_id = $1 AND is_active = true
                    ORDER BY version DESC
                    LIMIT 1
                `;
                
                const sourceResult = await dbClient.query(sourceRuleQuery, [ruleId]);
                
                if (sourceResult.rows.length === 0) {
                    console.warn(`⚠️ Source rule not found: ${ruleId}`);
                    errorCount++;
                    continue;
                }
                
                const sourceRule = sourceResult.rows[0];
                console.log(`✅ Found source rule: ${sourceRule.name} (${sourceRule.flag_name})`);
                
                // Parse eligibility_types using the same logic as edit/save functionality
                let eligibilityTypesArray = [];
                try {
                    const eligibilityData = sourceRule.eligibility_types;
                    if (typeof eligibilityData === 'string') {
                        eligibilityTypesArray = JSON.parse(eligibilityData);
                    } else if (Array.isArray(eligibilityData)) {
                        eligibilityTypesArray = eligibilityData;
                    } else {
                        eligibilityTypesArray = ['REBATES']; // Default fallback
                    }
                } catch (e) {
                    console.log(`⚠️ Invalid eligibility_types, using default: ${sourceRule.eligibility_types}`);
                    eligibilityTypesArray = ['REBATES']; // Default fallback
                }
                
                const eligibilityTypes = JSON.stringify(eligibilityTypesArray);
                console.log(`✅ Parsed eligibility_types:`, eligibilityTypes);
                
                // Check if a model rule already exists with this flag_name
                if (overwriteExisting) {
                    const existingModelQuery = `
                        SELECT rule_id FROM application.prism_enrichment_rules 
                        WHERE flag_name = $1 AND rule_category = $2 AND is_active = true
                    `;
                    
                    const existingResult = await dbClient.query(existingModelQuery, [sourceRule.flag_name, targetCategory]);
                    
                    if (existingResult.rows.length > 0) {
                        const existingRuleId = existingResult.rows[0].rule_id;
                        console.log(`🔄 Deactivating existing model rule: ${existingRuleId}`);
                        
                        // Deactivate existing model rule
                        await dbClient.query(
                            'UPDATE application.prism_enrichment_rules SET is_active = false WHERE rule_id = $1',
                            [existingRuleId]
                        );
                    }
                }
                
                // Generate new rule_id for the cloned rule
                const newRuleId = uuidv4();
                
                // Clone the rule with new category and dates
                const cloneQuery = `
                    INSERT INTO application.prism_enrichment_rules (
                        rule_id, version, name, pbm_code, rule_type, data_source, conditions,
                        flag_name, priority, is_standalone_executable, rule_category,
                        effective_from, is_active, created_by, eligibility_types
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12, $13, $14
                    )
                    RETURNING id, rule_id, version, name
                `;
                
                const cloneValues = [
                    newRuleId,              // New UUID for cloned rule
                    1,                      // Start with version 1
                    sourceRule.name,        // Keep same name
                    sourceRule.pbm_code,    // Keep same PBM
                    sourceRule.rule_type,   // Keep same type
                    sourceRule.data_source, // Keep same data source
                    sourceRule.conditions,  // Keep same conditions
                    sourceRule.flag_name,   // Keep same flag_name (business identifier)
                    sourceRule.priority,    // Keep same priority
                    sourceRule.is_standalone_executable, // Keep same executable setting
                    targetCategory,         // Change to target category (MODELING)
                    true,                   // Active
                    'clone_system',         // Mark as cloned by system
                    eligibilityTypes // Use sanitized eligibility types
                ];
                
                const cloneResult = await dbClient.query(cloneQuery, cloneValues);
                const clonedRule = cloneResult.rows[0];
                
                console.log(`✅ Successfully cloned rule: ${clonedRule.name} -> ${clonedRule.rule_id} v${clonedRule.version}`);
                
                clonedRules.push({
                    sourceRuleId: ruleId,
                    newRuleId: clonedRule.rule_id,
                    name: clonedRule.name,
                    version: clonedRule.version
                });
                
                successCount++;
                
            } catch (ruleError) {
                console.error(`❌ Failed to clone rule ${ruleId}:`, ruleError);
                errorCount++;
            }
        }
        
        await dbClient.query('COMMIT');
        
        const result = {
            success: errorCount === 0,
            message: `Successfully cloned ${successCount} rules to ${targetCategory}`,
            clonedRules,
            successCount,
            errorCount,
            totalRequested: ruleIds.length
        };
        
        console.log('✅ Clone operation completed:', result);
        return result;
        
    } catch (error) {
        await dbClient.query('ROLLBACK');
        console.error('❌ Clone operation failed:', error);
        throw error;
    }
}

// Handle PUT request to update rule
async function updateRule(client, ruleId, formData) {
    const dbClient = client;
    
    try {
        await dbClient.query('BEGIN');
        
        // Get current rule to copy non-changing fields
        const currentRuleQuery = `
            SELECT * FROM application.prism_enrichment_rules 
            WHERE rule_id = $1 AND is_active = true
        `;
        const currentRuleResult = await dbClient.query(currentRuleQuery, [ruleId]);
        
        if (currentRuleResult.rows.length === 0) {
            throw new Error('Rule not found');
        }
        
        const currentRule = currentRuleResult.rows[0];
        
        // FIXED: Handle multi-select eligibility types properly
        let eligibilityTypes = ['REBATES']; // Default
        
        console.log('Raw eligibility_types from form:', formData.eligibility_types);
        
        if (formData.eligibility_types) {
            if (Array.isArray(formData.eligibility_types)) {
                // Already an array from multi-select
                eligibilityTypes = formData.eligibility_types.filter(val => val && val.trim());
            } else if (typeof formData.eligibility_types === 'string') {
                // Could be a single value or comma-separated
                if (formData.eligibility_types.includes(',')) {
                    eligibilityTypes = formData.eligibility_types.split(',').map(s => s.trim()).filter(s => s);
                } else {
                    eligibilityTypes = [formData.eligibility_types.trim()];
                }
            }
        }
        
        // Ensure we have at least one valid eligibility type
        if (eligibilityTypes.length === 0) {
            eligibilityTypes = ['REBATES'];
        }
        
        console.log('Processed eligibility types:', eligibilityTypes);
        
        // Parse form data
        const updatedFields = {
            name: formData.name || currentRule.name,
            rule_type: formData.rule_type || currentRule.rule_type,
            pbm_code: formData.pbm_code || currentRule.pbm_code,
            data_source: formData.rule_type === 'COMPLEX' ? null : (formData.data_source || currentRule.data_source),
            conditions: formData.conditions || currentRule.conditions,
            flag_name: formData.flag_name || currentRule.flag_name,
            priority: parseInt(formData.priority) || currentRule.priority,
            rule_category: formData.rule_category || currentRule.rule_category,
            is_standalone_executable: formData.is_standalone_executable === 'on' || formData.is_standalone_executable === 'true',
            is_active: formData.is_active === 'on' || formData.is_active === 'true',
            eligibility_types: JSON.stringify(eligibilityTypes), // FIXED: Properly serialize array
            effective_from: formData.effective_from ? new Date(formData.effective_from) : currentRule.effective_from,
            effective_to: formData.effective_to ? new Date(formData.effective_to) : currentRule.effective_to
        };
        
        console.log('Final eligibility_types JSON:', updatedFields.eligibility_types);
        
        // Deactivate current version
        await dbClient.query(
            'UPDATE application.prism_enrichment_rules SET is_active = false WHERE rule_id = $1',
            [ruleId]
        );
        
        // Insert new version
        const insertQuery = `
            INSERT INTO application.prism_enrichment_rules (
                rule_id, version, name, pbm_code, rule_type, data_source, conditions,
                flag_name, priority, is_standalone_executable, rule_category,
                effective_from, effective_to, is_active, created_by, eligibility_types
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
            )
            RETURNING id, version
        `;
        
        const newVersion = currentRule.version + 1;
        const insertValues = [
            ruleId,
            newVersion,
            updatedFields.name,
            updatedFields.pbm_code,
            updatedFields.rule_type,
            updatedFields.data_source,
            updatedFields.conditions,
            updatedFields.flag_name,
            updatedFields.priority,
            updatedFields.is_standalone_executable,
            updatedFields.rule_category,
            updatedFields.effective_from,
            updatedFields.effective_to,
            updatedFields.is_active,
            'system',
            updatedFields.eligibility_types
        ];
        
        const insertResult = await dbClient.query(insertQuery, insertValues);
        await dbClient.query('COMMIT');
        
        console.log('Rule updated successfully:', {
            ruleId,
            oldVersion: currentRule.version,
            newVersion: insertResult.rows[0].version,
            eligibilityTypes: eligibilityTypes
        });
        
        return {
            success: true,
            message: 'Rule updated successfully',
            newVersion: insertResult.rows[0].version
        };
        
    } catch (error) {
        await dbClient.query('ROLLBACK');
        console.error('Error updating rule:', error);
        throw error;
    }
}

// Handle POST request to create new rule
async function createRule(client, formData) {
    const dbClient = client;

    try {
        await dbClient.query('BEGIN');

        console.log('Creating new rule with data:', formData);

        // Parse eligibility types from form data
        let eligibilityTypes = [];
        if (formData.eligibility_types) {
            if (Array.isArray(formData.eligibility_types)) {
                eligibilityTypes = formData.eligibility_types;
            } else {
                eligibilityTypes = [formData.eligibility_types];
            }
        } else {
            eligibilityTypes = ['REBATE_ELIGIBLE']; // Default
        }

        // Generate new rule_id
        const { v4: uuidv4 } = require('uuid');
        const newRuleId = uuidv4();

        // Validate required fields
        if (!formData.rule_name || !formData.flag_name || !formData.pbm_code || !formData.rule_type) {
            return {
                success: false,
                error: 'Missing required fields: rule_name, flag_name, pbm_code, and rule_type are required'
            };
        }

        if (!formData.conditions || formData.conditions.trim() === '') {
            return {
                success: false,
                error: 'Rule conditions are required and cannot be empty'
            };
        }

        // Prepare rule data
        const ruleData = {
            rule_id: newRuleId,
            version: 1,
            name: formData.rule_name.trim(),
            pbm_code: formData.pbm_code,
            rule_type: formData.rule_type,
            data_source: formData.data_source || null,
            conditions: formData.conditions.trim(),
            flag_name: formData.flag_name.trim(),
            priority: parseInt(formData.priority) || 100,
            is_standalone_executable: formData.is_standalone_executable === 'on' || formData.is_standalone_executable === 'true',
            rule_category: formData.rule_category || 'PRODUCTION',
            is_active: formData.is_active === 'on' || formData.is_active === 'true' || true,
            eligibility_types: JSON.stringify(eligibilityTypes),
            effective_from: formData.effective_from || null,
            effective_to: formData.effective_to || null
        };

        console.log('Final rule data:', ruleData);

        // Insert new rule
        const insertQuery = `
            INSERT INTO application.prism_enrichment_rules (
                rule_id, version, name, pbm_code, rule_type, data_source, conditions,
                flag_name, priority, is_standalone_executable, rule_category,
                effective_from, effective_to, is_active, created_by, eligibility_types
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
            )
            RETURNING id, rule_id, version
        `;

        const insertValues = [
            ruleData.rule_id,
            ruleData.version,
            ruleData.name,
            ruleData.pbm_code,
            ruleData.rule_type,
            ruleData.data_source,
            ruleData.conditions,
            ruleData.flag_name,
            ruleData.priority,
            ruleData.is_standalone_executable,
            ruleData.rule_category,
            ruleData.effective_from ? new Date(ruleData.effective_from) : new Date(), // Default to current date if not provided
            ruleData.effective_to ? new Date(ruleData.effective_to) : null,
            ruleData.is_active,
            'system',
            ruleData.eligibility_types
        ];

        const insertResult = await dbClient.query(insertQuery, insertValues);
        await dbClient.query('COMMIT');

        console.log('Rule created successfully:', {
            ruleId: newRuleId,
            version: insertResult.rows[0].version,
            name: ruleData.name
        });

        return {
            success: true,
            message: 'Rule created successfully',
            ruleId: newRuleId,
            version: insertResult.rows[0].version
        };

    } catch (error) {
        await dbClient.query('ROLLBACK');
        console.error('Error creating rule:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

const handler = async (event) => {
    // TEMPORARY: Force template cache refresh for debugging
    templateCache = {};

    console.log('🚀 Lambda started:', {
        method: event.httpMethod,
        path: event.path,
        queryParams: event.queryStringParameters
    });
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,hx-current-url,hx-request,hx-target,hx-trigger,hx-trigger-name,hx-vals,Authorization,X-Requested-With,Accept',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
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
        
        
        // Handle clone request
        if (method === 'POST' && event.queryStringParameters?.clone) {
            console.log('🎭 Clone request received');
            console.log('🎭 Request body:', event.body);
            console.log('🎭 Content-Type:', event.headers['Content-Type'] || event.headers['content-type']);
            
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
            
            console.log('Clone form data:', formData);
            
            const ruleIds = formData.rule_ids ? formData.rule_ids.split(',').map(id => id.trim()).filter(id => id) : [];
            const targetCategory = 'MODELING'; // Always create modeling rules
            const overwriteExisting = formData.overwrite_existing === 'on' || formData.overwrite_existing === 'true';
            
            console.log('🎯 Parsed clone parameters:');
            console.log('  - Rule IDs:', ruleIds);
            console.log('  - Target Category: MODELING (hardcoded)');
            console.log('  - Overwrite Existing:', overwriteExisting);
            
            if (ruleIds.length === 0) {
                return {
                    statusCode: 400,
                    headers,
                    body: '<div class="text-red-600">No rules selected for cloning</div>'
                };
            }
            
            try {
                const result = await cloneRules(client, ruleIds, targetCategory, overwriteExisting);
                await client.end();
                
                if (result.success) {
                    return {
                        statusCode: 200,
                        headers: { ...headers, 'HX-Trigger': 'rulesCloned, refreshFilters' },
                        body: `<div class="text-green-600">Successfully created ${result.successCount} modeling rules! Refreshing...</div>`
                    };
                } else {
                    return {
                        statusCode: 200,
                        headers: { ...headers, 'HX-Trigger': 'rulesCloned, refreshFilters' },
                        body: `<div class="text-yellow-600">Created ${result.successCount} modeling rules, ${result.errorCount} failed. Refreshing...</div>`
                    };
                }
                
            } catch (error) {
                console.error('Clone operation failed:', error);
                return {
                    statusCode: 500,
                    headers,
                    body: `<div class="text-red-600">Clone operation failed: ${error.message}</div>`
                };
            }
        }
        
        // Handle rule update using existing rules route
        if (method === 'PUT' && event.queryStringParameters?.update) {
            console.log('💾 Rule update request via rules route');
            const ruleId = event.queryStringParameters.update;
            if (!ruleId) {
                throw new Error('Rule ID required');
            }
            
            let formData = {};
            if (event.body) {
                if (event.headers['Content-Type']?.includes('application/json')) {
                    formData = JSON.parse(event.body);
                } else {
                    const params = new URLSearchParams(event.body);
                    for (const [key, value] of params) {
                        if (key.endsWith('[]')) {
                            const arrayKey = key.slice(0, -2);
                            if (!formData[arrayKey]) formData[arrayKey] = [];
                            formData[arrayKey].push(value);
                        } else {
                            formData[key] = value;
                        }
                    }
                }
            }
            
            const result = await updateRule(client, ruleId, formData);
            await client.end();
            
            if (result.success) {
                return {
                    statusCode: 200,
                    headers: { ...headers, 'HX-Trigger': 'ruleUpdated' },
                    body: '<div class="text-green-600">Rule updated successfully! Refreshing...</div>'
                };
            } else {
                return {
                    statusCode: 400,
                    headers,
                    body: '<div class="text-red-600">Failed to update rule</div>'
                };
            }
        }

        // Handle rule creation
        if (method === 'POST' && event.queryStringParameters?.action === 'create') {
            console.log('➕ Rule creation request via rules route');

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

            console.log('Form data for create:', formData);

            const result = await createRule(client, formData);
            await client.end();

            if (result.success) {
                return {
                    statusCode: 200,
                    headers: { ...headers, 'HX-Trigger': 'ruleCreated' },
                    body: '<div class="text-green-600">Rule created successfully! Refreshing...</div>'
                };
            } else {
                return {
                    statusCode: 400,
                    headers,
                    body: `<div class="text-red-600">Failed to create rule: ${result.error}</div>`
                };
            }
        }

        // Handle rule deletion
        if (method === 'POST' && (path.includes('/delete') || event.queryStringParameters?.action === 'delete')) {
            console.log('🗑️ Delete request received');
            console.log('Query parameters:', event.queryStringParameters);
            console.log('Path:', path);

            const ruleId = event.queryStringParameters?.id;
            console.log('🗑️ Deleting enrichment rule:', ruleId);

            if (!ruleId) {
                console.log('❌ No rule ID provided');
                return {
                    statusCode: 400,
                    headers,
                    body: '<div class="text-red-600">Rule ID required for deletion</div>'
                };
            }

            try {
                // Ensure client is connected for the delete operation
                if (!client._connected) {
                    console.log('🔄 Connecting client for delete operation...');
                    await client.connect();
                }

                console.log('🔄 Attempting to delete rule:', ruleId);
                const success = await deleteEnrichmentRule(client, ruleId);
                console.log('🔄 Delete result:', success);

                if (success) {
                    console.log('✅ Deleted rule:', ruleId);
                    await client.end();
                    return {
                        statusCode: 200,
                        headers: { ...headers, 'HX-Trigger': 'ruleDeleted' },
                        body: '<div class="text-green-600">Enrichment rule deleted successfully!</div>'
                    };
                } else {
                    await client.end();
                    return {
                        statusCode: 400,
                        headers,
                        body: '<div class="text-red-600">Rule not found or already deleted</div>'
                    };
                }
            } catch (error) {
                console.error('❌ Delete error:', error);
                console.error('❌ Error stack:', error.stack);
                try {
                    await client.end();
                } catch (e) {
                    console.error('Error closing client:', e);
                }
                return {
                    statusCode: 400,
                    headers,
                    body: `<div class="text-red-600">Error deleting rule: ${error.message}</div>`
                };
            }
        }

        // Handle rule reactivation
        if (method === 'POST' && event.queryStringParameters?.action === 'makeActive') {
            console.log('🔄 Make active rule request received');
            const ruleId = event.queryStringParameters?.id;

            if (!ruleId) {
                console.log('❌ No rule ID provided');
                return {
                    statusCode: 400,
                    headers,
                    body: '<div class="text-red-600">Rule ID required for activation</div>'
                };
            }

            try {
                // Ensure client is connected
                if (!client._connected) {
                    await client.connect();
                }

                console.log('🔄 Attempting to activate rule:', ruleId);

                // Update rule to set is_active = true
                const updateResult = await client.query(
                    'UPDATE application.prism_enrichment_rules SET is_active = true WHERE rule_id = $1 AND is_active = false',
                    [ruleId]
                );

                if (updateResult.rowCount > 0) {
                    console.log('✅ Rule activated successfully:', ruleId);

                    // Return refreshed rules table
                    const rulesHTML = await generateRulesHTML(client);
                    await client.end();

                    return {
                        statusCode: 200,
                        headers: { ...headers, 'HX-Trigger': 'ruleActivated' },
                        body: rulesHTML
                    };
                } else {
                    console.log('❌ Rule not found or already active:', ruleId);
                    await client.end();
                    return {
                        statusCode: 400,
                        headers,
                        body: '<div class="text-red-600">Rule not found or already active</div>'
                    };
                }

            } catch (error) {
                console.error('❌ Make active error:', error);
                try {
                    await client.end();
                } catch (e) {
                    console.error('❌ Error closing connection:', e);
                }
                return {
                    statusCode: 500,
                    headers,
                    body: `<div class="text-red-600">Error activating rule: ${error.message}</div>`
                };
            }
        }

        // Handle dynamic field loading by data source
        if (method === 'GET' && event.queryStringParameters?.get_fields) {
            console.log('🔄 Dynamic fields request');
            const dataSource = event.queryStringParameters.data_source;
            
            if (!dataSource) {
                return {
                    statusCode: 400,
                    headers,
                    body: '<option value="">Select Data Source First</option>'
                };
            }
            
            try {
                const fieldsData = await getFieldsByDataSource(client, dataSource);
                await client.end();
                
                // Build field options HTML
                const fieldOptions = fieldsData
                    .map(field => {
                        const displayName = field.business_name;
                        const helpText = field.help_text ? ` - ${field.help_text}` : '';
                        return `<option value="${field.technical_name}" 
                                    data-source="${field.data_source}" 
                                    data-type="${field.field_type}"
                                    title="${displayName}${helpText}">
                            ${displayName}
                        </option>`;
                    })
                    .join('');
                
                const finalHTML = `<option value="">Select Field</option>${fieldOptions}`;
                
                return {
                    statusCode: 200,
                    headers,
                    body: finalHTML
                };
                
            } catch (error) {
                console.error('Error loading fields:', error);
                return {
                    statusCode: 500,
                    headers,
                    body: '<option value="">Error loading fields</option>'
                };
            }
        }


        // Handle edit modal request
        if (method === 'GET' && event.queryStringParameters?.edit) {
            console.log('📝 Edit modal request via rules route');
            const ruleId = event.queryStringParameters.edit;
            if (!ruleId || ruleId.length !== 36) {
                throw new Error('Invalid Rule ID format');
            }

            const modalHTML = await getEditRuleModal(client, ruleId);
            await client.end();

            return {
                statusCode: 200,
                headers,
                body: modalHTML
            };
        }

        // Handle add modal request
        if (method === 'GET' && event.queryStringParameters?.component === 'add') {
            console.log('➕ Add modal request via rules route');

            const modalHTML = await getAddRuleModal(client);
            await client.end();

            return {
                statusCode: 200,
                headers,
                body: modalHTML
            };
        }

        // Handle clone modal request
        if (method === 'GET' && event.queryStringParameters?.component === 'clone' && event.queryStringParameters?.id) {
            console.log('📋 Clone modal request via rules route');
            const ruleId = event.queryStringParameters.id;
            if (!ruleId || ruleId.length !== 36) {
                throw new Error('Invalid Rule ID format');
            }

            const modalHTML = await getCloneRuleModal(client, ruleId);
            await client.end();

            return {
                statusCode: 200,
                headers,
                body: modalHTML
            };
        }

        // Check if this is a component request (filters or clone modal)
        const requestedComponent = event.queryStringParameters?.component;
        
        if (requestedComponent === 'filters' || path.includes('/filters')) {
            const filtersHTML = await generateFiltersHTML(client);
            await client.end();
            
            return {
                statusCode: 200,
                headers,
                body: filtersHTML
            };
        }
        
        if (requestedComponent === 'clone-modal') {
            console.log('📋 Loading clone modal template');
            try {
                const cloneModalTemplate = await getTemplate('clone-confirmation-modal.html');
                await client.end();
                
                return {
                    statusCode: 200,
                    headers,
                    body: cloneModalTemplate
                };
            } catch (error) {
                console.error('Failed to load clone modal template:', error);
                await client.end();
                
                return {
                    statusCode: 500,
                    headers,
                    body: '<div class="text-red-500 p-4">Failed to load clone modal template</div>'
                };
            }
        }
        
        // =====================================
        // MAIN RULES LISTING LOGIC
        // =====================================
        console.log('📋 Rules listing request');
        
        const [tableTemplate, rowTemplate] = await Promise.all([
            getTemplate('rules-table.html'),
            getTemplate('rule-row.html')
        ]);
        
        // Parse query parameters and form data
        let filters = event.queryStringParameters || {};
        
        // Handle POST request body (for filter form submissions)
        if (event.httpMethod === 'POST' && event.body) {
            try {
                const formData = new URLSearchParams(event.body);
                // Merge form data with query params
                for (const [key, value] of formData) {
                    if (value && value.trim()) {
                        filters[key] = value.trim();
                    }
                }
            } catch (e) {
                console.warn('Failed to parse form data:', e);
            }
        }
        
        // Set defaults
        const page = parseInt(filters.page || '1');
        const limit = 15;
        const offset = (page - 1) * limit;
        
        // Build dynamic query with filters
        const filterQuery = buildFilterQuery(filters);
        
        console.log('Applied filters:', filters);
        console.log('Filter query:', filterQuery.whereClause);
        
        // Get total count for pagination
        const countQuery = `
            SELECT COUNT(*) as total
            FROM application.prism_enrichment_rules 
            WHERE ${filterQuery.whereClause}
        `;
        
        const countResult = await client.query(countQuery, filterQuery.params);
        const totalRules = parseInt(countResult.rows[0].total);
        
        // Get paginated rules
        const rulesQuery = `
            SELECT id, rule_id, version, name, pbm_code, rule_type, data_source, 
                   conditions, flag_name, priority, is_active, created_by,
                   TO_CHAR(updated_at, 'MM/DD/YYYY') as updated_at_formatted,
                   TO_CHAR(effective_from, 'MM/DD/YYYY') as effective_from_formatted
            FROM application.prism_enrichment_rules 
            WHERE ${filterQuery.whereClause}
            ORDER BY priority, updated_at DESC 
            LIMIT $${filterQuery.params.length + 1} OFFSET $${filterQuery.params.length + 2}
        `;
        
        const queryParams = [...filterQuery.params, limit, offset];
        const result = await client.query(rulesQuery, queryParams);
        
        await client.end();
        
        // Generate rows using row template
        const rulesHTML = result.rows.map((rule, index) => {
            const rowData = {
                ROW_CLASS: index % 2 === 0 ? 'bg-white' : 'bg-gray-50',
                RULE_ID: rule.rule_id,
                NAME: rule.name,
                VERSION: rule.version,
                UPDATED_AT: rule.updated_at_formatted,
                PBM_CODE: rule.pbm_code,
                RULE_TYPE: rule.rule_type,
                TYPE_BADGE_CLASS: getBadgeClass(rule.rule_type),
                CONDITIONS: rule.conditions?.substring(0, 50) + '...' || 'No condition',
                IS_ACTIVE: rule.is_active
            };
            
            return renderTemplate(rowTemplate, rowData);
        }).join('');
        
        // Calculate pagination - handle zero results properly
        const totalPages = Math.ceil(totalRules / limit);
        const startRecord = totalRules > 0 ? offset + 1 : 0;
        const endRecord = totalRules > 0 ? Math.min(offset + result.rows.length, totalRules) : 0;

        // Generate pagination buttons
        const paginationButtons = generatePaginationButtons(page, totalPages, filters);

        // Render final table
        const finalHTML = renderTemplate(tableTemplate, {
            RULES_ROWS: rulesHTML,
            START_RECORD: startRecord,
            END_RECORD: endRecord,
            TOTAL_RULES: totalRules,
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

// Delete enrichment rule (set is_active to false)
async function deleteEnrichmentRule(client, ruleId) {
    try {
        const deleteQuery = `
            UPDATE application.prism_enrichment_rules SET
                is_active = false,
                updated_at = CURRENT_TIMESTAMP
            WHERE rule_id = $1 AND is_active = true
        `;

        const result = await client.query(deleteQuery, [ruleId]);
        return result.rowCount > 0;

    } catch (error) {
        console.error('Failed to delete enrichment rule:', error);
        throw error;
    }
}

// Your original function (unchanged)
function getBadgeClass(ruleType) {
    const classes = {
        'SIMPLE': 'bg-teal-100 text-teal-800',
        'COMPLEX': 'bg-blue-100 text-blue-800',
        'CLIENT': 'bg-purple-100 text-purple-800'
    };
    return classes[ruleType] || 'bg-gray-100 text-gray-800';
}

// Enhanced pagination with filter preservation
function generatePaginationButtons(currentPage, totalPages, filters) {
    if (totalPages <= 1) return '';
    
    // Build query string with current filters for pagination
    const filterParams = new URLSearchParams();
    Object.keys(filters).forEach(key => {
        if (filters[key] && key !== 'page') {
            filterParams.append(key, filters[key]);
        }
    });
    const baseQuery = filterParams.toString();
    
    let buttons = '';
    
    // Previous button
    if (currentPage > 1) {
        const prevQuery = baseQuery ? `${baseQuery}&page=${currentPage - 1}` : `page=${currentPage - 1}`;
        buttons += `<button hx-get="https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/rules?${prevQuery}" hx-target="#rules-container" class="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50">Previous</button>`;
    }
    
    // Page numbers (show max 5 pages)
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, startPage + 4);
    
    for (let i = startPage; i <= endPage; i++) {
        const isActive = i === currentPage;
        const bgClass = isActive ? 'text-blue-600 bg-blue-50 border-blue-500' : 'text-gray-500 bg-white border-gray-300 hover:bg-gray-50';
        const pageQuery = baseQuery ? `${baseQuery}&page=${i}` : `page=${i}`;
        buttons += `<button hx-get="https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/rules?${pageQuery}" hx-target="#rules-container" class="px-3 py-2 text-sm font-medium ${bgClass} border rounded-md">${i}</button>`;
    }
    
    // Next button
    if (currentPage < totalPages) {
        const nextQuery = baseQuery ? `${baseQuery}&page=${currentPage + 1}` : `page=${currentPage + 1}`;
        buttons += `<button hx-get="https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/rules?${nextQuery}" hx-target="#rules-container" class="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50">Next</button>`;
    }
    
    return buttons;
}

// DON'T FORGET THIS!
exports.handler = handler;