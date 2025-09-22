/**
 * Global App Utilities & HTMX Event Handlers
 * Claims Enrichment Rules Management System
 */

// Global namespace for the app
window.ClaimsApp = window.ClaimsApp || {};

// Utility functions
ClaimsApp.utils = {
    /**
     * Show notification to user
     */
    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        if (!notification) {
            console.warn('Notification div not found');
            return;
        }
        
        const bgColor = {
            'success': 'bg-green-100 border-green-400 text-green-700',
            'error': 'bg-red-100 border-red-400 text-red-700',
            'info': 'bg-blue-100 border-blue-400 text-blue-700',
            'warning': 'bg-yellow-100 border-yellow-400 text-yellow-700'
        }[type] || 'bg-blue-100 border-blue-400 text-blue-700';
        
        notification.innerHTML = `
            <div class="${bgColor} px-4 py-3 rounded border mb-4 shadow-lg">
                <div class="flex items-center justify-between">
                    <span>${message}</span>
                    <button onclick="this.parentElement.parentElement.remove()" class="ml-4 text-lg font-bold">×</button>
                </div>
            </div>
        `;
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.firstElementChild) {
                notification.firstElementChild.remove();
            }
        }, 5000);
    },

    /**
     * Toggle dropdown menus
     */
    toggleDropdown(dropdownId) {
        // Close all other dropdowns first
        document.querySelectorAll('[id^="dropdown-"]').forEach(dropdown => {
            if (dropdown.id !== dropdownId) {
                dropdown.classList.add('hidden');
            }
        });
        
        // Toggle the clicked dropdown
        const dropdown = document.getElementById(dropdownId);
        if (dropdown) {
            dropdown.classList.toggle('hidden');
        }
    },

    /**
     * Show custom confirmation dialog
     */
    showConfirmDialog(title, message, onConfirm, onCancel = null) {
        // Create modal backdrop
        const backdrop = document.createElement('div');
        backdrop.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center';

        // Create modal content
        const modal = document.createElement('div');
        modal.className = 'bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden';

        modal.innerHTML = `
            <div class="px-6 py-4 border-b border-gray-200">
                <h3 class="text-lg font-semibold text-gray-900">${title}</h3>
            </div>
            <div class="px-6 py-4">
                <p class="text-gray-600">${message}</p>
            </div>
            <div class="px-6 py-4 bg-gray-50 flex justify-end gap-3">
                <button id="confirm-cancel" class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    Cancel
                </button>
                <button id="confirm-delete" class="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500">
                    Delete
                </button>
            </div>
        `;

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        // Handle button clicks
        const cancelBtn = modal.querySelector('#confirm-cancel');
        const deleteBtn = modal.querySelector('#confirm-delete');

        const cleanup = () => {
            if (backdrop.parentNode) {
                backdrop.parentNode.removeChild(backdrop);
            }
        };

        cancelBtn.addEventListener('click', () => {
            cleanup();
            if (onCancel) onCancel();
        });

        deleteBtn.addEventListener('click', () => {
            cleanup();
            onConfirm();
        });

        // Close on backdrop click
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                cleanup();
                if (onCancel) onCancel();
            }
        });

        // Close on ESC key
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                cleanup();
                document.removeEventListener('keydown', handleEsc);
                if (onCancel) onCancel();
            }
        };
        document.addEventListener('keydown', handleEsc);
    }
};

// Initialize HTMX Event Handlers when DOM is ready
function initializeHTMXEventHandlers() {
    if (!document.body) {
        console.warn('Document body not ready, deferring HTMX handlers');
        return;
    }

    // HTMX Event Handlers
    document.body.addEventListener('htmx:responseError', function(evt) {
        console.error('HTMX Response Error:', evt.detail);
        ClaimsApp.utils.showNotification('Error loading data. Please try again.', 'error');
    });

    document.body.addEventListener('htmx:sendError', function(evt) {
        console.error('HTMX Send Error:', evt.detail);
        ClaimsApp.utils.showNotification('Network error. Please check your connection.', 'error');
    });

    document.body.addEventListener('htmx:afterRequest', function(evt) {
        if (evt.detail.successful) {
            console.log('HTMX request successful');
            
            // Re-initialize filters if they were loaded via HTMX
            if (evt.detail.target && evt.detail.target.id === 'filters-container') {
                console.log('Filters loaded via HTMX, reinitializing...');
                ClaimsApp.filters.initializeFilters();
            }
            
            // Re-enable field select after HTMX loads new options (for rule modal)
            const fieldSelect = document.getElementById('field-select');
            if (fieldSelect && evt.detail.target === fieldSelect) {
                fieldSelect.disabled = false;
                console.log('Field dropdown re-enabled with new options');
                
                // Check if we got fields or an error
                if (fieldSelect.options.length <= 1) {
                    console.warn('No fields loaded for selected data source');
                    ClaimsApp.utils.showNotification('No fields found for this data source', 'warning');
                } else {
                    console.log('Successfully loaded', fieldSelect.options.length - 1, 'fields');
                    ClaimsApp.utils.showNotification('Fields loaded successfully!', 'success');
                }
            }
        } else {
            console.error('HTMX request failed:', evt.detail);
        }
    });

    // Enhanced HTMX error handling for field loading
    document.body.addEventListener('htmx:responseError', function(event) {
        console.error('HTMX error:', event.detail);
        
        const fieldSelect = document.getElementById('field-select');
        if (fieldSelect && event.detail.target === fieldSelect) {
            fieldSelect.innerHTML = '<option value="">Error loading fields</option>';
            fieldSelect.disabled = false;
            ClaimsApp.utils.showNotification('Failed to load fields. Please try again.', 'error');
        }
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', function(event) {
        if (!event.target.closest('[onclick*="toggleDropdown"]') && 
            !event.target.closest('[id^="dropdown-"]')) {
            document.querySelectorAll('[id^="dropdown-"]').forEach(dropdown => {
                dropdown.classList.add('hidden');
            });
        }
        
        // Close eligibility dropdown when clicking outside
        if (!event.target.closest('#eligibility-dropdown') && 
            !event.target.closest('[onclick*="toggleEligibilityDropdown"]')) {
            const eligibilityDropdown = document.getElementById('eligibility-dropdown');
            const eligibilityChevron = document.getElementById('eligibility-chevron');
            if (eligibilityDropdown && !eligibilityDropdown.classList.contains('hidden')) {
                eligibilityDropdown.classList.add('hidden');
                if (eligibilityChevron) eligibilityChevron.style.transform = 'rotate(0deg)';
            }
        }
    });

    // Handle rule deletion - refresh the rules table
    document.body.addEventListener('ruleDeleted', function(evt) {
        console.log('Rule deleted, refreshing rules table...');
        // Trigger refresh of rules table
        const rulesContainer = document.getElementById('rules-container');
        if (rulesContainer) {
            htmx.ajax('GET', 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/rules', {
                target: '#rules-container',
                swap: 'innerHTML'
            });
        }
    });

    console.log('✅ HTMX event handlers initialized');
}

// Action handlers for rules
ClaimsApp.actions = {
    editRule(ruleId) {
        console.log('Edit rule:', ruleId);
        ClaimsApp.modal.openEditModal(ruleId);
    },

    cloneRule(ruleId) {
        console.log('Clone rule:', ruleId);
        // Select this rule and show clone modal
        ClaimsApp.bulkActions.selectSingleRule(ruleId);
        ClaimsApp.bulkActions.showCloneModal();
    },

    modelRule(ruleId) {
        console.log('Create model from rule:', ruleId);
        // Alias for cloneRule - same functionality
        this.cloneRule(ruleId);
    },

    deleteRule(ruleId) {
        ClaimsApp.utils.showConfirmDialog(
            'Confirm Deletion',
            'Are you sure you want to delete this enrichment rule? This action cannot be undone.',
            () => {
                console.log('User confirmed deletion for rule:', ruleId);

                // Send delete request via HTMX and manually refresh table
                htmx.ajax('POST', `https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/rules?action=delete&id=${ruleId}`)
                .then((response) => {
                    console.log('Delete request completed successfully');
                    // Show success notification
                    ClaimsApp.utils.showNotification('Rule deleted successfully!', 'success');

                    // Manually refresh the rules table by reapplying current filters
                    setTimeout(() => {
                        console.log('Refreshing rules table after deletion...');
                        // Trigger a filter refresh which will reload the table with current filter state
                        const applyButton = document.querySelector('#apply-filters-btn');
                        if (applyButton) {
                            applyButton.click();
                        } else {
                            // Fallback: reload page if filter apply button not found
                            window.location.reload();
                        }
                    }, 1000); // Small delay to show the success message
                })
                .catch((error) => {
                    console.error('Delete request failed:', error);
                    // Show error notification
                    ClaimsApp.utils.showNotification('Failed to delete rule. Please try again.', 'error');
                });
            }
        );
    }
};

// Filter management functions
ClaimsApp.filters = {
    /**
     * Update filter badges display
     */
    updateFilterBadges() {
        const badges = document.getElementById('filter-badges');
        const activeFiltersDiv = document.getElementById('active-filters');
        const filterCount = document.getElementById('filter-count');
        
        if (!badges || !activeFiltersDiv || !filterCount) return;
        
        // Clear existing badges
        badges.innerHTML = '';
        let count = 0;
        
        // Get all filter inputs with values
        document.querySelectorAll('#filter-body select, #filter-body input').forEach(input => {
            if (input.value && input.value.trim() !== '') {
                count++;
                const label = input.previousElementSibling?.textContent?.replace(':', '') || input.name;
                const badge = document.createElement('span');
                badge.className = 'bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full filter-badge';
                badge.innerHTML = `${label}: ${input.value} <button onclick="ClaimsApp.filters.clearFilter('${input.name}')" class="ml-1 text-blue-600 hover:text-blue-800">×</button>`;
                badges.appendChild(badge);
            }
        });
        
        // Update filter count
        filterCount.textContent = `${count} active`;
        
        // Show/hide active filters section
        if (count > 0) {
            activeFiltersDiv.classList.remove('hidden');
        } else {
            activeFiltersDiv.classList.add('hidden');
        }
    },

    /**
     * Clear a specific filter
     */
    clearFilter(filterName) {
        const input = document.querySelector(`[name="${filterName}"]`);
        if (input) {
            input.value = '';
            this.updateFilterBadges();
            this.applyFilters();
        }
    },

    /**
     * Clear all filters
     */
    clearAllFilters() {
        document.querySelectorAll('#filter-body select, #filter-body input').forEach(input => {
            if (input.type === 'checkbox') {
                input.checked = false;
            } else {
                input.value = '';
            }
        });
        this.updateFilterBadges();
        
        // Make a clean request with no filters
        htmx.ajax('GET', 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/rules', {
            target: '#rules-container'
        });
    },

    /**
     * Apply current filters
     */
    applyFilters() {
        this.updateFilterBadges();
        
        // Build clean query string - only include non-empty values
        const formData = new FormData();
        let hasFilters = false;
        
        document.querySelectorAll('#filter-body select, #filter-body input').forEach(input => {
            if (input.value && input.value.trim() !== '') {
                formData.append(input.name, input.value.trim());
                hasFilters = true;
            }
        });
        
        // Use POST to send clean data
        htmx.ajax('POST', 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/rules', {
            target: '#rules-container',
            values: Object.fromEntries(formData)
        });
    },

    /**
     * Toggle filters collapse/expand
     */
    toggleFilters() {
        const body = document.getElementById('filter-body');
        const chevron = document.getElementById('filter-chevron');
        
        if (!body || !chevron) return;
        
        if (body.classList.contains('collapse')) {
            body.classList.remove('collapse');
            body.classList.add('expand');
            chevron.style.transform = 'rotate(180deg)';
        } else {
            body.classList.remove('expand');
            body.classList.add('collapse');
            chevron.style.transform = 'rotate(0deg)';
        }
    },

    /**
     * Apply quick filter presets
     */
    applyQuickFilter(type) {
        this.clearAllFilters();
        
        switch(type) {
            case 'active':
                document.querySelector('select[name="status_filter"]').value = 'active';
                break;
            case 'complex':
                document.querySelector('select[name="rule_type_filter"]').value = 'COMPLEX';
                break;
            case 'recent':
                // For recent changes, we'd need to add a date filter back
                // For now, just show all rules
                break;
        }
        
        this.applyFilters();
    },

    /**
     * Initialize filter event listeners
     */
    initializeFilters() {
        console.log('Initializing filters...');
        
        // Check if filter elements exist
        const filterBody = document.getElementById('filter-body');
        if (!filterBody) {
            console.warn('Filter body not found, skipping filter initialization');
            return;
        }
        
        // Add change listeners for real-time badge updates and auto-apply
        const filterInputs = filterBody.querySelectorAll('select, input');
        console.log(`Found ${filterInputs.length} filter inputs`);
        
        filterInputs.forEach(input => {
            // Remove existing listeners to avoid duplicates
            input.removeEventListener('change', this.handleFilterChange);
            input.removeEventListener('keyup', this.handleFilterKeyup);
            
            // Add new listeners
            input.addEventListener('change', this.handleFilterChange.bind(this));
            input.addEventListener('keyup', this.handleFilterKeyup.bind(this));
        });
        
        // Start with filters expanded
        if (filterBody) {
            filterBody.classList.remove('collapse');
            filterBody.classList.add('expand');
        }
        
        // Check for pre-selected values and trigger initial rule loading
        const pbmFilter = document.querySelector('[name="pbm_filter"]');
        if (pbmFilter && pbmFilter.value && pbmFilter.value.trim() !== '') {
            console.log('Pre-selected PBM found:', pbmFilter.value, 'triggering initial rule load...');
            this.applyFilters();
        }
    },

    /**
     * Handle filter change events
     */
    handleFilterChange() {
        this.updateFilterBadges();
        this.applyFilters();
    },

    /**
     * Handle filter keyup events
     */
    handleFilterKeyup(event) {
        this.updateFilterBadges();
        // Debounced auto-apply for text inputs
        if (event.target.type === 'text' || event.target.type === 'search') {
            clearTimeout(event.target.debounceTimer);
            event.target.debounceTimer = setTimeout(() => {
                this.applyFilters();
            }, 500);
        }
    }
};

// Bulk Actions functionality
ClaimsApp.bulkActions = {
    selectedRules: new Set(),
    
    /**
     * Toggle select all checkbox
     */
    toggleSelectAll(masterCheckbox) {
        const checkboxes = document.querySelectorAll('.rule-checkbox');
        const isChecked = masterCheckbox.checked;
        
        checkboxes.forEach(checkbox => {
            checkbox.checked = isChecked;
            const ruleId = checkbox.dataset.ruleId;
            if (isChecked) {
                this.selectedRules.add(ruleId);
            } else {
                this.selectedRules.delete(ruleId);
            }
        });
        
        this.updateSelectionUI();
    },
    
    /**
     * Update selection when individual checkbox changes
     */
    updateSelection() {
        const checkboxes = document.querySelectorAll('.rule-checkbox');
        const masterCheckbox = document.getElementById('select-all-rules');
        
        // Update selectedRules set
        this.selectedRules.clear();
        checkboxes.forEach(checkbox => {
            if (checkbox.checked) {
                this.selectedRules.add(checkbox.dataset.ruleId);
            }
        });
        
        // Update master checkbox state
        if (masterCheckbox) {
            const totalCheckboxes = checkboxes.length;
            const checkedCheckboxes = this.selectedRules.size;
            
            if (checkedCheckboxes === 0) {
                masterCheckbox.checked = false;
                masterCheckbox.indeterminate = false;
            } else if (checkedCheckboxes === totalCheckboxes) {
                masterCheckbox.checked = true;
                masterCheckbox.indeterminate = false;
            } else {
                masterCheckbox.checked = false;
                masterCheckbox.indeterminate = true;
            }
        }
        
        this.updateSelectionUI();
    },
    
    /**
     * Update the bulk actions UI based on selection
     */
    updateSelectionUI() {
        const bulkActionsBar = document.getElementById('bulk-actions-bar');
        const selectedCount = document.getElementById('selected-count');
        
        if (!bulkActionsBar || !selectedCount) return;
        
        const count = this.selectedRules.size;
        
        if (count > 0) {
            bulkActionsBar.classList.remove('hidden');
            selectedCount.textContent = `${count} rule${count !== 1 ? 's' : ''} selected`;
        } else {
            bulkActionsBar.classList.add('hidden');
        }
    },
    
    /**
     * Clear all selections
     */
    clearSelection() {
        this.selectedRules.clear();
        const checkboxes = document.querySelectorAll('.rule-checkbox, #select-all-rules');
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
            checkbox.indeterminate = false;
        });
        this.updateSelectionUI();
    },
    
    /**
     * Select a single rule (for individual clone)
     */
    selectSingleRule(ruleId) {
        this.clearSelection();
        this.selectedRules.add(ruleId);
        
        // Check the corresponding checkbox
        const checkbox = document.querySelector(`[data-rule-id="${ruleId}"]`);
        if (checkbox) {
            checkbox.checked = true;
        }
        
        this.updateSelectionUI();
    },
    
    /**
     * Show clone confirmation modal
     */
    showCloneModal() {
        if (this.selectedRules.size === 0) {
            ClaimsApp.utils.showNotification('Please select at least one rule to clone', 'warning');
            return;
        }
        
        console.log('Opening clone modal for rules:', Array.from(this.selectedRules));
        ClaimsApp.modal.openCloneModal(Array.from(this.selectedRules));
    },
    
    /**
     * Process clone operation
     */
    async cloneSelectedRules(formData) {
        const ruleIds = Array.from(this.selectedRules);
        
        if (ruleIds.length === 0) {
            ClaimsApp.utils.showNotification('No rules selected for cloning', 'error');
            return;
        }
        
        try {
            console.log('Cloning rules:', ruleIds);
            ClaimsApp.utils.showNotification(`Cloning ${ruleIds.length} rule${ruleIds.length !== 1 ? 's' : ''}...`, 'info');
            
            // The form will handle the actual HTMX request
            // This is just for logging and UI feedback
            
        } catch (error) {
            console.error('Clone operation failed:', error);
            ClaimsApp.utils.showNotification('Failed to clone rules. Please try again.', 'error');
        }
    }
};

// Make functions globally available for onclick handlers IMMEDIATELY
window.showNotification = ClaimsApp.utils.showNotification;
window.toggleDropdown = ClaimsApp.utils.toggleDropdown;
window.editRule = ClaimsApp.actions.editRule;
window.cloneRule = ClaimsApp.actions.cloneRule;
window.modelRule = ClaimsApp.actions.modelRule;
window.deleteRule = ClaimsApp.actions.deleteRule;

// Filter functions - must be available immediately for onclick handlers
window.updateFilterBadges = function() { 
    if (ClaimsApp.filters) ClaimsApp.filters.updateFilterBadges(); 
};
window.clearFilter = function(filterName) { 
    if (ClaimsApp.filters) ClaimsApp.filters.clearFilter(filterName); 
};
window.clearAllFilters = function() { 
    if (ClaimsApp.filters) ClaimsApp.filters.clearAllFilters(); 
};
window.applyFilters = function() { 
    if (ClaimsApp.filters) ClaimsApp.filters.applyFilters(); 
};
window.toggleFilters = function() { 
    console.log('toggleFilters called');
    if (ClaimsApp.filters) {
        ClaimsApp.filters.toggleFilters();
    } else {
        console.error('ClaimsApp.filters not available');
    }
};
window.applyQuickFilter = function(type) { 
    if (ClaimsApp.filters) ClaimsApp.filters.applyQuickFilter(type); 
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM ready, initializing ClaimsApp...');
    
    // Initialize HTMX event handlers
    initializeHTMXEventHandlers();
    
    // Initialize filters if they exist
    if (document.getElementById('filter-body')) {
        ClaimsApp.filters.initializeFilters();
    }
});

// Also try to initialize immediately if DOM is already loaded
if (document.readyState === 'loading') {
    // DOM is still loading, wait for DOMContentLoaded
    console.log('DOM still loading, waiting for DOMContentLoaded...');
} else {
    // DOM is already loaded
    console.log('DOM already loaded, initializing immediately...');
    initializeHTMXEventHandlers();
    if (document.getElementById('filter-body')) {
        ClaimsApp.filters.initializeFilters();
    }
}

// Tab switching functionality
window.switchTab = function(tabName) {
    console.log('Switching to tab:', tabName);
    
    // Hide all tab panes
    const tabPanes = document.querySelectorAll('.tab-pane');
    tabPanes.forEach(pane => {
        pane.classList.remove('active');
    });
    
    // Remove active class from all tab buttons
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
        button.classList.remove('active');
    });
    
    // Show the selected tab pane
    const selectedPane = document.getElementById(tabName + '-content');
    if (selectedPane) {
        selectedPane.classList.add('active');
    }
    
    // Activate the selected tab button
    const selectedButton = document.getElementById(tabName + '-tab');
    if (selectedButton) {
        selectedButton.classList.add('active');
    }
    
    // Re-initialize filters based on tab
    if (tabName === 'rules' && document.getElementById('filter-body')) {
        // Add small delay to ensure DOM is ready
        setTimeout(() => {
            if (ClaimsApp.filters) {
                ClaimsApp.filters.initializeFilters();
            }
        }, 100);
    } else if (tabName === 'price-modeling') {
        // Initialize price modeling filters
        setTimeout(() => {
            if (ClaimsApp.priceModeling) {
                ClaimsApp.priceModeling.initializeFilters();
            }
        }, 100);
    }
};

// Price Modeling functionality
ClaimsApp.priceModeling = {
    /**
     * Initialize price modeling filters
     */
    initializeFilters() {
        console.log('Initializing price modeling filters...');
        
        // Check if filter elements exist
        const filterBody = document.getElementById('price-filter-body');
        if (!filterBody) {
            console.warn('Price filter body not found, skipping initialization');
            return;
        }
        
        // Add change listeners for real-time updates
        const filterInputs = filterBody.querySelectorAll('select, input');
        console.log(`Found ${filterInputs.length} price filter inputs`);
        
        filterInputs.forEach(input => {
            // Remove existing listeners to avoid duplicates
            input.removeEventListener('change', this.handleFilterChange.bind(this));
            input.removeEventListener('keyup', this.handleFilterKeyup.bind(this));
            
            // Add new listeners
            input.addEventListener('change', this.handleFilterChange.bind(this));
            input.addEventListener('keyup', this.handleFilterKeyup.bind(this));
        });
        
        // Start with filters expanded
        if (filterBody) {
            filterBody.classList.remove('collapse');
            filterBody.classList.add('expand');
        }
        
        // Check for pre-selected values and trigger initial model loading
        const pbmFilter = document.querySelector('[name="pbm_filter"]');
        if (pbmFilter && pbmFilter.value && pbmFilter.value.trim() !== '') {
            console.log('Pre-selected PBM found:', pbmFilter.value, 'triggering initial price models load...');
            this.applyFilters();
        }
    },

    /**
     * Handle filter change events
     */
    handleFilterChange() {
        this.updateFilterBadges();
        this.applyFilters();
    },

    /**
     * Handle filter keyup events (for search inputs)
     */
    handleFilterKeyup(event) {
        if (event.key === 'Enter') {
            this.applyFilters();
        }
        // Update badges in real-time
        this.updateFilterBadges();
    },

    /**
     * Apply current filters and load price models
     */
    applyFilters() {
        this.updateFilterBadges();

        // Build form data from filters
        const formData = new FormData();
        let hasFilters = false;

        document.querySelectorAll('#price-filter-body select, #price-filter-body input').forEach(input => {
            if (input.value && input.value.trim() !== '') {
                formData.append(input.name, input.value.trim());
                hasFilters = true;
            }
        });

        console.log('Applying price modeling filters...', Object.fromEntries(formData));

        if (hasFilters) {
            // Use POST to send filter data when filters are applied
            htmx.ajax('POST', 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/price-models', {
                target: '#price-models-container',
                values: Object.fromEntries(formData)
            });
        } else {
            // Use GET when no filters (clear all)
            htmx.ajax('GET', 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/price-models', {
                target: '#price-models-container'
            });
        }
    },

    /**
     * Update filter badges display
     */
    updateFilterBadges() {
        const activeFilters = document.getElementById('price-active-filters');
        const filterBadges = document.getElementById('price-filter-badges');
        const filterCount = document.getElementById('price-filter-count');
        
        if (!activeFilters || !filterBadges || !filterCount) return;
        
        const badges = [];
        let count = 0;
        
        // Check each filter for active values
        document.querySelectorAll('#price-filter-body select, #price-filter-body input').forEach(input => {
            if (input.value && input.value.trim() !== '') {
                const label = input.closest('.space-y-2')?.querySelector('label')?.textContent || input.name;
                let displayValue = input.value;
                
                // For selects, use the display text
                if (input.tagName === 'SELECT') {
                    const selectedOption = input.options[input.selectedIndex];
                    displayValue = selectedOption ? selectedOption.textContent : input.value;
                }
                
                badges.push(`
                    <span class="filter-badge bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full flex items-center gap-1">
                        <span>${label}: ${displayValue}</span>
                        <button onclick="ClaimsApp.priceModeling.removeFilter('${input.name}')" 
                                class="text-blue-600 hover:text-blue-800 ml-1">×</button>
                    </span>
                `);
                count++;
            }
        });
        
        filterBadges.innerHTML = badges.join('');
        filterCount.textContent = `${count} active`;
        
        if (count > 0) {
            activeFilters.classList.remove('hidden');
        } else {
            activeFilters.classList.add('hidden');
        }
    },

    /**
     * Remove a specific filter
     */
    removeFilter(filterName) {
        const input = document.querySelector(`[name="${filterName}"]`);
        if (input) {
            input.value = '';
            this.applyFilters();
        }
    },

    /**
     * Toggle filter visibility
     */
    toggleFilters() {
        const body = document.getElementById('price-filter-body');
        const chevron = document.getElementById('price-filter-chevron');
        
        if (!body || !chevron) return;
        
        if (body.classList.contains('collapse')) {
            body.classList.remove('collapse');
            body.classList.add('expand');
            chevron.style.transform = 'rotate(180deg)';
        } else {
            body.classList.remove('expand');
            body.classList.add('collapse');
            chevron.style.transform = 'rotate(0deg)';
        }
    }
};

// Global functions for price modeling
window.togglePriceFilters = function() {
    if (ClaimsApp.priceModeling) {
        ClaimsApp.priceModeling.toggleFilters();
    }
};

window.clearPriceFilters = function() {
    document.querySelectorAll('#price-filter-body select, #price-filter-body input').forEach(input => {
        input.value = '';
    });
    if (ClaimsApp.priceModeling) {
        ClaimsApp.priceModeling.applyFilters();
    }
};

window.createNewPriceModel = function() {
    console.log('Create new price model');
    // TODO: Implement modal for creating new price model
};

window.openAddModelModal = function() {
    console.log('Opening add model modal');

    // Prevent background scrolling
    document.body.style.overflow = 'hidden';

    // Load the add model form via HTMX
    htmx.ajax('GET', 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/price-models?component=add', {
        target: 'body',
        swap: 'beforeend'
    }).then(() => {
        // Focus the modal for ESC key handling
        const modal = document.getElementById('add-model-modal');
        if (modal) {
            modal.focus();
        }
    });
};

window.closeAddModelModal = function() {
    const modal = document.getElementById('add-model-modal');
    if (modal) {
        modal.remove();
    }

    // Restore background scrolling
    document.body.style.overflow = '';
};

window.editPriceModel = function(modelId) {
    console.log('Edit price model:', modelId);

    // Prevent background scrolling
    document.body.style.overflow = 'hidden';

    // Load the edit model form via HTMX
    htmx.ajax('GET', `https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/price-models?component=edit&id=${modelId}`, {
        target: 'body',
        swap: 'beforeend'
    }).then(() => {
        // Focus the modal for ESC key handling
        const modal = document.getElementById('edit-model-modal');
        if (modal) {
            modal.focus();
        }
    });
};

window.closeEditModelModal = function() {
    const modal = document.getElementById('edit-model-modal');
    if (modal) {
        modal.remove();
    }

    // Restore background scrolling
    document.body.style.overflow = '';
};

window.clonePriceModel = function(modelId) {
    console.log('Clone price model:', modelId);

    // Prevent background scrolling
    document.body.style.overflow = 'hidden';

    // Load the clone model form via HTMX (reuses add template with pre-filled data)
    htmx.ajax('GET', `https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/price-models?component=clone&id=${modelId}`, {
        target: 'body',
        swap: 'beforeend'
    }).then(() => {
        // Focus the modal for ESC key handling
        const modal = document.getElementById('add-model-modal');
        if (modal) {
            modal.focus();
        }
    });
};


window.analyzePriceModel = function(modelId) {
    console.log('Analyze price model:', modelId);
    // TODO: Implement analysis modal
};

window.showComparisonView = function() {
    console.log('Show comparison view');
    // TODO: Implement comparison modal
};

window.bulkClonePriceModels = function() {
    console.log('Bulk clone price models');
    // TODO: Implement bulk clone
};

window.bulkComparePriceModels = function() {
    console.log('Bulk compare price models');
    // TODO: Implement bulk comparison
};

// Ensure deletePriceModel is globally available
if (typeof window.deletePriceModel === 'undefined') {
    console.warn('deletePriceModel not found, defining it globally');
    window.deletePriceModel = function(modelId) {
        console.log('Delete price model:', modelId);

        // Use custom confirmation dialog
        ClaimsApp.utils.showConfirmDialog(
            'Confirm Deletion',
            'Are you sure you want to delete this price model? This action cannot be undone.',
            () => {
                console.log('User confirmed deletion for model:', modelId);

                // Send delete request via HTMX and manually refresh table
                htmx.ajax('POST', `https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/price-models?action=delete&id=${modelId}`)
                .then((response) => {
                    console.log('Price model delete request completed successfully');
                    // Show success notification
                    ClaimsApp.utils.showNotification('Price model deleted successfully!', 'success');

                    // Refresh page to maintain correct tab/filter state after price model deletion
                    setTimeout(() => {
                        console.log('Refreshing page after price model deletion to maintain tab state...');
                        window.location.reload();
                    }, 1000); // Small delay to show the success message
                })
                .catch((error) => {
                    console.error('Delete request failed:', error);
                    // Show error notification
                    ClaimsApp.utils.showNotification('Failed to delete price model. Please try again.', 'error');
                });
            },
            () => {
                console.log('User cancelled price model deletion');
            }
        );
    };
}

// Make Active Price Model function
window.makeActivePriceModel = function(modelId) {
    console.log('Make active price model:', modelId);

    // Show confirmation dialog
    if (confirm('Are you sure you want to make this price model active? This will restore the model.')) {
        console.log('User confirmed activation for model:', modelId);

        // Send make active request via HTMX
        htmx.ajax('POST', `https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/price-models?action=makeActive&id=${modelId}`, {
            target: '#price-models-container'
        }).then(() => {
            // Show success notification
            showNotification('Price model activated successfully!', 'success');

            // Refresh the table after successful activation
            htmx.ajax('GET', 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/price-models', {
                target: '#price-models-container'
            });
        }).catch(error => {
            console.error('Make active failed:', error);
            showNotification('Failed to activate price model. Please try again.', 'error');
        });
    }
};

//======================================================================
// ENRICHMENT RULES - ADD NEW RULE FUNCTIONALITY
//======================================================================

// Open Add Rule Modal
window.openAddRuleModal = function() {
    console.log('Opening add rule modal');

    // Prevent background scrolling
    document.body.style.overflow = 'hidden';

    // Load the add rule form via HTMX
    htmx.ajax('GET', 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/rules?component=add', {
        target: 'body',
        swap: 'beforeend'
    }).then(() => {
        // Focus the modal for ESC key handling
        const modal = document.getElementById('add-rule-modal');
        if (modal) {
            modal.focus();
        }
    });
};

// Close Add Rule Modal
window.closeAddRuleModal = function() {
    console.log('Closing add rule modal');

    const modal = document.getElementById('add-rule-modal');
    if (modal) {
        modal.remove();
    }

    // Restore background scrolling
    document.body.style.overflow = 'auto';
};

// Handle Add Rule Response
window.handleAddRuleResponse = function(event) {
    console.log('Add rule response:', event.detail);

    if (event.detail.successful) {
        // Close modal and show success message
        closeAddRuleModal();
        showNotification('Enrichment rule created successfully!', 'success');

        // Refresh the rules table
        htmx.ajax('GET', 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/rules', {
            target: '#rules-container'
        });
    } else {
        // Show error message
        showNotification('Failed to create rule. Please try again.', 'error');
    }
};

// Handle Rule Type Change (show/hide sections based on Simple vs Complex)
window.handleRuleTypeChange = function(ruleType) {
    const simpleSection = document.getElementById('simple-section');
    const complexSection = document.getElementById('complex-section');
    const dataSourceSelect = document.querySelector('select[name="data_source"]');

    if (ruleType === 'SIMPLE') {
        simpleSection.classList.remove('hidden');
        complexSection.classList.add('hidden');
        if (dataSourceSelect) {
            dataSourceSelect.required = true;
        }
    } else if (ruleType === 'COMPLEX') {
        complexSection.classList.remove('hidden');
        simpleSection.classList.add('hidden');
        if (dataSourceSelect) {
            dataSourceSelect.required = false;
            dataSourceSelect.value = '';
        }
    } else {
        // No type selected - hide both
        simpleSection.classList.add('hidden');
        complexSection.classList.add('hidden');
        if (dataSourceSelect) {
            dataSourceSelect.required = false;
        }
    }
};

// Load Data Source Fields (for future implementation)
window.loadDataSourceFields = function(dataSource) {
    console.log('Loading fields for data source:', dataSource);
    // TODO: Implement dynamic field loading based on data source
};

// Helper function to update conditions textarea (for both simple and complex builders)
window.updateConditionsTextarea = function(conditions) {
    const conditionsTextarea = document.getElementById('conditions-textarea');
    if (conditionsTextarea) {
        conditionsTextarea.value = conditions;
        console.log('Updated conditions textarea:', conditions);
    }
};

// Placeholder functions for rule builders (to be implemented later if needed)
window.buildCondition = function() {
    console.log('Build condition function called - placeholder');
    // This would build conditions for simple rules
    // For now, users need to manually enter conditions
};

window.addFlag = function() {
    console.log('Add flag function called - placeholder');
    // This would add flags to complex rule expressions
    // For now, users need to manually enter conditions
};

window.addOperator = function(operator) {
    console.log('Add operator function called:', operator);
    // This would add operators to complex rule expressions
};

window.clearExpression = function() {
    console.log('Clear expression function called');
    // Clear the expression builder and update textarea
    updateConditionsTextarea('');
};

window.clearAllConditions = function() {
    console.log('Clear all conditions function called');
    // Clear the condition builder and update textarea
    updateConditionsTextarea('');
};

// Validate Rule Form Before Submission
window.validateRuleForm = function(event) {
    console.log('Validating rule form before submission');

    const form = document.getElementById('add-rule-form');
    const ruleType = form.querySelector('select[name="rule_type"]').value;
    const conditions = form.querySelector('textarea[name="conditions"]').value.trim();
    const ruleName = form.querySelector('input[name="rule_name"]').value.trim();
    const flagName = form.querySelector('input[name="flag_name"]').value.trim();
    const pbmCode = form.querySelector('select[name="pbm_code"]').value;

    // Check required fields
    if (!ruleName) {
        showNotification('Rule name is required', 'error');
        event.preventDefault();
        return false;
    }

    if (!flagName) {
        showNotification('Flag name is required', 'error');
        event.preventDefault();
        return false;
    }

    if (!pbmCode) {
        showNotification('PBM selection is required', 'error');
        event.preventDefault();
        return false;
    }

    if (!ruleType) {
        showNotification('Rule type is required', 'error');
        event.preventDefault();
        return false;
    }

    // Check conditions based on rule type
    if (ruleType === 'SIMPLE') {
        const dataSource = form.querySelector('select[name="data_source"]').value;
        if (!dataSource) {
            showNotification('Data source is required for Simple rules', 'error');
            event.preventDefault();
            return false;
        }
    }

    // Always check for conditions - they cannot be empty
    if (!conditions) {
        showNotification('Rule conditions are required. Please build your rule conditions using the visual builder.', 'error');
        event.preventDefault();
        return false;
    }

    // Check eligibility types - at least one must be selected
    const eligibilityTypes = form.querySelectorAll('input[name="eligibility_types"]:checked');
    if (eligibilityTypes.length === 0) {
        showNotification('At least one eligibility type must be selected', 'error');
        event.preventDefault();
        return false;
    }

    console.log('Form validation passed');
    return true;
};

// Clone Individual Rule (already exists but let me enhance it)
window.cloneRule = function(ruleId) {
    console.log('Clone rule:', ruleId);

    // Prevent background scrolling
    document.body.style.overflow = 'hidden';

    // Load the clone rule form via HTMX (reuses add template with pre-filled data)
    htmx.ajax('GET', `https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/rules?component=clone&id=${ruleId}`, {
        target: 'body',
        swap: 'beforeend'
    }).then(() => {
        // Focus the modal for ESC key handling
        const modal = document.getElementById('add-rule-modal');
        if (modal) {
            modal.focus();
        }
    });
};

console.log('🚀 ClaimsApp utilities loaded');