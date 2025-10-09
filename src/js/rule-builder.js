/**
 * Rule Builder System
 * Handles both Simple and Complex rule building logic
 */

ClaimsApp.ruleBuilder = {
    // State management
    state: {
        expressionParts: [],
        builtConditions: [],
        isInitialized: false
    },

    /**
     * Initialize the rule builder modal
     */
    initializeModal() {
        console.log('🔄 Initializing modal...');
        
        // Always reset state when initializing a new modal
        this.state.expressionParts = [];
        this.state.builtConditions = [];
        this.state.isInitialized = false;
        
        const ruleTypeInput = document.querySelector('input[name="rule_type"]');
        console.log('🔍 Rule type input element:', ruleTypeInput);
        console.log('🔍 Rule type value:', ruleTypeInput?.value);
        
        const ruleType = ruleTypeInput?.value;
        if (ruleType) {
            console.log(`✅ Found rule type: ${ruleType}, toggling UI...`);
            this.toggleRuleType(ruleType);
        } else {
            console.warn('❌ No rule type found, defaulting to SIMPLE');
            this.toggleRuleType('SIMPLE');
        }
        this.loadExistingConditions();
        this.state.isInitialized = true;
        this.updateState();
        
        // Initialize eligibility dropdown
        if (ClaimsApp.eligibilityDropdown) {
            ClaimsApp.eligibilityDropdown.initialize();
        }
        
        console.log('✅ Modal initialization complete');
    },

    /**
     * Toggle between Simple and Complex rule types
     */
    toggleRuleType(type) {
        console.log(`🔄 Toggling rule type to: ${type}`);
        
        // Reset all state when switching rule types
        this.state.expressionParts = [];
        this.state.builtConditions = [];
        
        const complexSection = document.getElementById('complex-section');
        const simpleSection = document.getElementById('simple-section');
        const dataSourceField = document.getElementById('data-source-field');
        
        console.log('🔍 DOM Elements found:');
        console.log('  - complexSection:', complexSection);
        console.log('  - simpleSection:', simpleSection);
        console.log('  - dataSourceField:', dataSourceField);
        
        if (type === 'COMPLEX') {
            console.log('📱 Setting up COMPLEX rule UI...');
            if (complexSection) {
                complexSection.classList.remove('hidden');
                console.log('  ✅ Complex section shown');
            } else {
                console.error('  ❌ Complex section not found!');
            }
            if (simpleSection) {
                simpleSection.classList.add('hidden');
                console.log('  ✅ Simple section hidden');
            } else {
                console.error('  ❌ Simple section not found!');
            }
            if (dataSourceField) {
                dataSourceField.style.display = 'none';
                console.log('  ✅ Data source field hidden');
            }
            
            // Clear simple rule artifacts completely
            this.clearAllConditions();
            this.resetSimpleRuleUI();
            
            this.loadExistingExpression();
        } else {
            console.log('📝 Setting up SIMPLE rule UI...');
            if (complexSection) {
                complexSection.classList.add('hidden');
                console.log('  ✅ Complex section hidden');
            } else {
                console.error('  ❌ Complex section not found!');
            }
            if (simpleSection) {
                simpleSection.classList.remove('hidden');
                console.log('  ✅ Simple section shown');
            } else {
                console.error('  ❌ Simple section not found!');
            }
            if (dataSourceField) {
                dataSourceField.style.display = 'block';
                console.log('  ✅ Data source field shown');
            }
            
            // Clear complex rule artifacts completely
            this.clearExpression();
            this.resetComplexRuleUI();
        }
        
        this.updateState();
        console.log(`✅ Rule type toggle to ${type} complete`);
    },

    /**
     * Reset simple rule UI to clean state
     */
    resetSimpleRuleUI() {
        // Reset data source dropdown
        const dataSourceSelect = document.querySelector('select[name="data_source"]');
        if (dataSourceSelect) dataSourceSelect.value = '';
        
        // Reset field select
        const fieldSelect = document.getElementById('field-select');
        if (fieldSelect) fieldSelect.innerHTML = '<option value="">Select Data Source First</option>';
        
        // Clear built conditions display
        const builtConditions = document.getElementById('built-conditions');
        if (builtConditions) builtConditions.innerHTML = '<span class="text-gray-500 text-sm">No conditions added yet...</span>';
        
        // Reset condition count
        const conditionCount = document.getElementById('condition-count');
        if (conditionCount) conditionCount.textContent = '0 conditions';
        
        // Clear final SQL preview
        this.updateFinalSQLPreview('');
    },

    /**
     * Reset complex rule UI to clean state
     */
    resetComplexRuleUI() {
        // Reset flag selector
        const flagSelector = document.getElementById('flag-selector');
        if (flagSelector) flagSelector.value = '';
        
        // Clear expression builder
        const expressionBuilder = document.getElementById('expression-builder');
        if (expressionBuilder) {
            expressionBuilder.innerHTML = '<span id="empty-hint" class="text-blue-500 text-sm">Add flags below to build your expression...</span>';
        }
        
        // Clear SQL preview
        const sqlPreview = document.getElementById('sql-preview');
        if (sqlPreview) sqlPreview.textContent = 'No conditions yet...';
        
        // Reset status indicator
        const statusIndicator = document.getElementById('status-indicator');
        if (statusIndicator) {
            statusIndicator.textContent = 'Valid';
            statusIndicator.className = 'text-xs px-2 py-1 rounded bg-green-100 text-green-700';
        }
    },

    /**
     * Update global state for persistence
     */
    updateState() {
        window.modalState = window.modalState || {};
        window.modalState.expressionParts = this.state.expressionParts;
        window.modalState.builtConditions = this.state.builtConditions;
        window.modalState.isInitialized = this.state.isInitialized;
    },

    /**
     * Load existing conditions from textarea
     */
    loadExistingConditions() {
        const textarea = document.getElementById('conditions-textarea');
        if (textarea && textarea.value.trim()) {
            const existingCondition = textarea.value.trim();
            console.log('Loading existing conditions:', existingCondition);
            this.updateFinalSQLPreview(existingCondition);
        }
    },

    /**
     * Load existing expression for complex rules
     */
    loadExistingExpression() {
        const textarea = document.getElementById('conditions-textarea');
        if (textarea && textarea.value.trim()) {
            const existingCondition = textarea.value.trim();
            console.log('Loading existing expression:', existingCondition);
            
            const parts = existingCondition.split(/\s+/);
            this.state.expressionParts = parts;
            this.updateExpressionDisplay();
            this.updateSQLPreview();
            this.updateState();
        }
    },

    // SIMPLE RULE BUILDER METHODS
    /**
     * Build a condition for simple rules
     */
    buildCondition() {
        const field = document.getElementById('field-select')?.value;
        const operator = document.getElementById('operator-select')?.value;
        const value = document.getElementById('value-input')?.value;
        
        if (!field || !operator || !value) {
            alert('Please fill in all fields first!');
            return;
        }
        
        let newCondition = `${field} ${operator} `;
        if (operator.includes('IN')) {
            const values = value.split(',').map(v => `'${v.trim()}'`).join(', ');
            newCondition += `(${values})`;
        } else if (operator.includes('LIKE')) {
            newCondition += `'%${value}%'`;
        } else {
            // Check if value is a boolean (true/false) - don't wrap in quotes
            const normalizedValue = value.trim().toLowerCase();
            if (normalizedValue === 'true' || normalizedValue === 'false') {
                newCondition += normalizedValue;
            } else {
                newCondition += `'${value}'`;
            }
        }
        
        // Only store one condition for simple rules
        this.state.builtConditions = [{
            field: field,
            operator: operator,
            value: value,
            condition: newCondition
        }];
        
        this.updateBuiltConditionsDisplay();
        this.clearConditionInputs();
        this.updateState();
    },

    /**
     * Remove a condition
     */
    removeCondition(index) {
        this.state.builtConditions.splice(index, 1);
        this.updateBuiltConditionsDisplay();
        this.updateState();
    },

    /**
     * Clear all conditions
     */
    clearAllConditions() {
        this.state.builtConditions = [];
        this.updateBuiltConditionsDisplay();
        this.clearConditionInputs();
        this.updateState();
    },

    /**
     * Clear condition input fields
     */
    clearConditionInputs() {
        const fieldSelect = document.getElementById('field-select');
        const operatorSelect = document.getElementById('operator-select');
        const valueInput = document.getElementById('value-input');
        
        if (fieldSelect) fieldSelect.value = '';
        if (operatorSelect) operatorSelect.value = '=';
        if (valueInput) valueInput.value = '';
    },

    /**
     * Update built conditions display
     */
    updateBuiltConditionsDisplay() {
        const container = document.getElementById('built-conditions');
        const countSpan = document.getElementById('condition-count');
        
        if (!container) return;
        
        const conditionCount = this.state.builtConditions.length;
        if (countSpan) {
            countSpan.textContent = `${conditionCount} condition${conditionCount !== 1 ? 's' : ''}`;
        }
        
        if (this.state.builtConditions.length === 0) {
            container.innerHTML = '<span class="text-gray-500 text-sm">No conditions added yet...</span>';
            this.updateFinalSQLPreview('');
            return;
        }
        
        const conditionsHTML = this.state.builtConditions.map((condition, index) => {
            return `
                <span class="inline-flex items-center gap-1 px-3 py-1 rounded bg-green-100 text-green-800 text-sm">
                    ${condition.field} ${condition.operator} ${condition.value}
                    <button type="button" onclick="ClaimsApp.ruleBuilder.removeCondition(${index})" class="ml-1 text-green-600 hover:text-green-800 text-xs">×</button>
                </span>
            `;
        }).join(' ');
        
        container.innerHTML = conditionsHTML;
        
        // Build final SQL
        const finalSQL = this.state.builtConditions.map(c => c.condition).join('');
        this.updateFinalSQLPreview(finalSQL);
    },

    /**
     * Update final SQL preview
     */
    updateFinalSQLPreview(sql) {
        const preview = document.getElementById('final-sql-preview');
        const textarea = document.getElementById('conditions-textarea');
        const status = document.getElementById('sql-status');
        
        if (!preview || !textarea) return;
        
        if (sql.trim()) {
            preview.textContent = sql;
            preview.className = 'font-mono text-sm bg-white p-2 rounded border min-h-[30px] text-gray-900';
            textarea.value = sql;
            
            if (status) {
                status.textContent = 'Valid';
                status.className = 'text-xs px-2 py-1 rounded bg-green-100 text-green-700';
            }
        } else {
            preview.textContent = 'No conditions set...';
            preview.className = 'font-mono text-sm bg-white p-2 rounded border min-h-[30px] text-gray-500';
            textarea.value = '';
            
            if (status) {
                status.textContent = 'Empty';
                status.className = 'text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-700';
            }
        }
    },

    /**
     * Handle field selection
     */
    handleFieldSelection(fieldValue) {
        console.log('Field selected:', fieldValue);
    },

    /**
     * Handle data source change
     */
    handleDataSourceChange(dataSource) {
        console.log('Data source changed to:', dataSource);
        
        const fieldSelect = document.getElementById('field-select');
        
        if (!dataSource) {
            if (fieldSelect) {
                fieldSelect.innerHTML = '<option value="">Select Data Source First</option>';
            }
            this.clearAllConditions();
            return;
        }
        
        this.clearAllConditions();
        
        // Show loading state
        if (fieldSelect) {
            fieldSelect.innerHTML = '<option value="">Loading fields...</option>';
            fieldSelect.disabled = true;
        }
        
        // Make HTMX request for fields
        const url = `https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/rules?get_fields=true&data_source=${encodeURIComponent(dataSource)}`;
        
        console.log('Making HTMX request to:', url);
        
        htmx.ajax('GET', url, {
            target: '#field-select',
            swap: 'innerHTML'
        }).then(() => {
            console.log('Fields loaded successfully!');
            if (fieldSelect) {
                fieldSelect.disabled = false;
            }
            ClaimsApp.utils.showNotification('Fields loaded successfully!', 'success');
        }).catch((error) => {
            console.error('Failed to load fields:', error);
            if (fieldSelect) {
                fieldSelect.innerHTML = '<option value="">Error loading fields</option>';
                fieldSelect.disabled = false;
            }
            ClaimsApp.utils.showNotification('Failed to load fields. Please try again.', 'error');
        });
    },

    // COMPLEX RULE BUILDER METHODS
    /**
     * Add flag to complex expression
     */
    addFlag() {
        const selector = document.getElementById('flag-selector');
        const flag = selector.value;
        
        if (!flag) {
            alert('Pick a flag first!');
            return;
        }
        
        this.state.expressionParts.push(flag);
        selector.value = '';
        this.updateExpressionDisplay();
        this.updateSQLPreview();
        this.updateState();
    },

    /**
     * Add operator to complex expression
     */
    addOperator(op) {
        if (this.state.expressionParts.length === 0 && op !== 'NOT') {
            alert('Add a flag first!');
            return;
        }
        
        this.state.expressionParts.push(op);
        this.updateExpressionDisplay();
        this.updateSQLPreview();
        this.updateState();
    },

    /**
     * Add parenthesis to complex expression
     */
    addParenthesis(paren) {
        this.state.expressionParts.push(paren);
        this.updateExpressionDisplay();
        this.updateSQLPreview();
        this.updateState();
    },

    /**
     * Clear complex expression
     */
    clearExpression() {
        this.state.expressionParts = [];
        this.updateExpressionDisplay();
        this.updateSQLPreview();
        this.updateState();
    },

    /**
     * Remove token from expression
     */
    removeToken(index) {
        this.state.expressionParts.splice(index, 1);
        this.updateExpressionDisplay();
        this.updateSQLPreview();
        this.updateState();
    },

    /**
     * Update expression display for complex rules
     */
    updateExpressionDisplay() {
        const container = document.getElementById('expression-builder');
        
        if (!container) return;
        
        if (this.state.expressionParts.length === 0) {
            container.innerHTML = '<span id="empty-hint" class="text-blue-500 text-sm">Add flags below to build your expression...</span>';
            return;
        }
        
        const tokensHTML = this.state.expressionParts.map((part, index) => {
            let colorClass = 'bg-gray-200 text-gray-800';
            
            if (['AND', 'OR'].includes(part)) {
                colorClass = 'bg-blue-100 text-blue-800';
            } else if (part === 'NOT') {
                colorClass = 'bg-red-100 text-red-800';
            } else if (['(', ')'].includes(part)) {
                colorClass = 'bg-purple-100 text-purple-800';
            } else {
                colorClass = 'bg-green-100 text-green-800';
            }
            
            return `
                <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${colorClass}">
                    ${part}
                    <button type="button" onclick="ClaimsApp.ruleBuilder.removeToken(${index})" class="ml-1 text-current hover:bg-black hover:bg-opacity-20 rounded-full w-4 h-4 flex items-center justify-center text-xs">
                        ×
                    </button>
                </span>
            `;
        }).join('');
        
        container.innerHTML = tokensHTML;
    },

    /**
     * Update SQL preview for complex rules
     */
    updateSQLPreview() {
        const preview = document.getElementById('sql-preview');
        const textarea = document.getElementById('conditions-textarea');
        const status = document.getElementById('status-indicator');
        
        if (!preview || !textarea) return;
        
        const sql = this.state.expressionParts.join(' ');
        preview.textContent = sql || 'No conditions yet...';
        textarea.value = sql;
        
        if (sql.trim() && status) {
            const isValid = this.validateExpression(sql);
            status.textContent = isValid ? 'Valid' : 'Check syntax';
            status.className = `text-xs px-2 py-1 rounded ${isValid ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`;
        }
    },

    /**
     * Validate complex expression syntax
     */
    validateExpression(expr) {
        let parenCount = 0;
        const tokens = expr.split(/\s+/);
        
        for (const token of tokens) {
            if (token === '(') parenCount++;
            if (token === ')') parenCount--;
            if (parenCount < 0) return false;
        }
        
        return parenCount === 0 && tokens.length > 0;
    }
};

// Eligibility Types Multi-Select Dropdown Functions
ClaimsApp.eligibilityDropdown = {
    selectedValues: new Set(),
    
    toggle() {
        const dropdown = document.getElementById('eligibility-dropdown');
        const chevron = document.getElementById('eligibility-chevron');
        
        if (!dropdown || !chevron) return;
        
        if (dropdown.classList.contains('hidden')) {
            dropdown.classList.remove('hidden');
            chevron.style.transform = 'rotate(180deg)';
        } else {
            dropdown.classList.add('hidden');
            chevron.style.transform = 'rotate(0deg)';
        }
    },
    
    toggleOption(value, label, checkbox) {
        if (checkbox.checked) {
            this.selectedValues.add(value);
        } else {
            this.selectedValues.delete(value);
        }
        
        this.updateDisplay();
        this.updateHiddenSelect();
    },
    
    updateDisplay() {
        const display = document.getElementById('eligibility-display');
        if (!display) return;
        
        if (this.selectedValues.size === 0) {
            display.innerHTML = '<span class="text-gray-500 text-sm">Select eligibility types...</span>';
        } else {
            const badges = Array.from(this.selectedValues).map(value => {
                return `<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    ${value}
                    <button type="button" onclick="ClaimsApp.eligibilityDropdown.removeValue('${value}')" class="ml-1 text-blue-600 hover:text-blue-800">×</button>
                </span>`;
            }).join('');
            display.innerHTML = badges;
        }
    },
    
    removeValue(value) {
        this.selectedValues.delete(value);
        
        // Uncheck the corresponding checkbox
        const checkbox = document.querySelector(`input[value="${value}"][data-eligibility-option]`);
        if (checkbox) checkbox.checked = false;
        
        this.updateDisplay();
        this.updateHiddenSelect();
    },
    
    updateHiddenSelect() {
        const hiddenSelect = document.getElementById('eligibility-hidden-select');
        if (!hiddenSelect) return;
        
        // Clear all selections
        Array.from(hiddenSelect.options).forEach(option => option.selected = false);
        
        // Select the chosen values
        this.selectedValues.forEach(value => {
            const option = hiddenSelect.querySelector(`option[value="${value}"]`);
            if (option) option.selected = true;
        });
    },
    
    initialize() {
        // Initialize from existing selected values in hidden select
        const hiddenSelect = document.getElementById('eligibility-hidden-select');
        const optionsContainer = document.getElementById('eligibility-options');
        
        if (!hiddenSelect || !optionsContainer) return;
        
        // Generate checkboxes from select options
        const checkboxes = Array.from(hiddenSelect.options).map(option => {
            if (!option.value) return ''; // Skip empty options
            
            const isSelected = option.selected;
            if (isSelected) {
                this.selectedValues.add(option.value);
            }
            
            return `
                <label class="flex items-center p-2 hover:bg-gray-50 rounded cursor-pointer">
                    <input type="checkbox" 
                           value="${option.value}" 
                           ${isSelected ? 'checked' : ''}
                           data-eligibility-option
                           onchange="toggleEligibilityOption('${option.value}', '${option.textContent}', this)"
                           class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded">
                    <span class="ml-3 text-sm font-medium text-gray-700">${option.textContent}</span>
                </label>
            `;
        }).filter(html => html).join('');
        
        optionsContainer.innerHTML = checkboxes;
        this.updateDisplay();
    }
};

// Make functions globally available for onclick handlers
window.buildCondition = ClaimsApp.ruleBuilder.buildCondition.bind(ClaimsApp.ruleBuilder);
window.removeCondition = ClaimsApp.ruleBuilder.removeCondition.bind(ClaimsApp.ruleBuilder);
window.clearAllConditions = ClaimsApp.ruleBuilder.clearAllConditions.bind(ClaimsApp.ruleBuilder);
window.handleFieldSelection = ClaimsApp.ruleBuilder.handleFieldSelection.bind(ClaimsApp.ruleBuilder);
window.handleDataSourceChange = ClaimsApp.ruleBuilder.handleDataSourceChange.bind(ClaimsApp.ruleBuilder);

// Complex rule functions
window.addFlag = ClaimsApp.ruleBuilder.addFlag.bind(ClaimsApp.ruleBuilder);
window.addOperator = ClaimsApp.ruleBuilder.addOperator.bind(ClaimsApp.ruleBuilder);
window.addParenthesis = ClaimsApp.ruleBuilder.addParenthesis.bind(ClaimsApp.ruleBuilder);
window.clearExpression = ClaimsApp.ruleBuilder.clearExpression.bind(ClaimsApp.ruleBuilder);
window.removeToken = ClaimsApp.ruleBuilder.removeToken.bind(ClaimsApp.ruleBuilder);

// Eligibility dropdown functions
window.toggleEligibilityDropdown = ClaimsApp.eligibilityDropdown.toggle.bind(ClaimsApp.eligibilityDropdown);
window.toggleEligibilityOption = ClaimsApp.eligibilityDropdown.toggleOption.bind(ClaimsApp.eligibilityDropdown);

// Initialize modal when script loads (delayed to ensure DOM is ready)
function initializeRuleBuilderIfNeeded() {
    console.log('🎯 initializeRuleBuilderIfNeeded called');
    const editForm = document.getElementById('edit-rule-form');
    console.log('🎯 edit-rule-form element:', editForm);
    
    if (editForm) {
        console.log('✅ Found edit-rule-form, initializing rule builder...');
        ClaimsApp.ruleBuilder.initializeModal();
    } else {
        console.log('❌ edit-rule-form not found, skipping rule builder initialization');
        console.log('🔍 Available form elements:', document.querySelectorAll('form'));
    }
}

// Initialize on script load
setTimeout(initializeRuleBuilderIfNeeded, 100);

// CRITICAL: Re-initialize when modal content is loaded via HTMX
function setupHTMXListener() {
    if (!document.body) {
        console.warn('Document body not ready for HTMX listener, retrying...');
        setTimeout(setupHTMXListener, 100);
        return;
    }
    
    document.body.addEventListener('htmx:afterRequest', function(evt) {
        console.log('🎯 HTMX afterRequest in rule-builder:', evt.detail);
        
        // Check if this was a modal content load
        if (evt.detail.target && evt.detail.target.id === 'modal-content') {
            console.log('🎯 Modal content loaded via HTMX, reinitializing rule builder...');
            setTimeout(() => {
                console.log('🎯 Attempting to reinitialize rule builder...');
                initializeRuleBuilderIfNeeded();
            }, 50);
        } else {
            console.log('🎯 HTMX request was not for modal-content, target:', evt.detail.target?.id);
        }
    });
    
    console.log('✅ HTMX listener for rule builder initialized');
}

// Set up the HTMX listener
setupHTMXListener();

console.log('🚀 Rule builder loaded');