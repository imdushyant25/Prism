/**
 * Global App Utilities & HTMX Event Handlers
 * Claims Enrichment Rules Management System
 */


// Global namespace for the app
window.ClaimsApp = window.ClaimsApp || {};

// Utility functions
ClaimsApp.utils = {
    /**
     * Show notification
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
     * Toggle dropdown menus with smart positioning
     */
    toggleDropdown(dropdownId) {
        // Close all other dropdowns first
        document.querySelectorAll('[id^="dropdown-"]').forEach(dropdown => {
            if (dropdown.id !== dropdownId) {
                dropdown.classList.add('hidden');
                ClaimsApp.utils.restoreDropdownToOriginalParent(dropdown);
            }
        });

        // Toggle the clicked dropdown
        const dropdown = document.getElementById(dropdownId);
        if (dropdown) {
            const isHidden = dropdown.classList.contains('hidden');
            dropdown.classList.toggle('hidden');

            if (isHidden) {
                // Dropdown is being shown, fix positioning
                ClaimsApp.utils.positionDropdown(dropdown);
            }
        }
    },

    /**
     * Smart dropdown positioning to avoid container and pagination clipping
     */
    positionDropdown(dropdown) {
        // Get the trigger button - need to find it before potentially moving dropdown
        let trigger = dropdown.parentElement;

        // If dropdown is already moved to body, find the trigger by dropdown ID
        if (trigger === document.body) {
            // Extract the button index from dropdown ID (e.g., "dropdown-actions-1" -> "1")
            const dropdownIdMatch = dropdown.id.match(/dropdown-actions-(\d+)/);
            if (dropdownIdMatch) {
                const buttonIndex = dropdownIdMatch[1];
                // Find the corresponding trigger button
                trigger = document.querySelector(`[onclick="ClaimsApp.utils.toggleDropdown('dropdown-actions-${buttonIndex}')"]`);
            }
        }

        if (!trigger) {
            console.error('Could not find trigger button for dropdown:', dropdown.id);
            return;
        }

        const triggerRect = trigger.getBoundingClientRect();

        // Move dropdown to body to escape container clipping
        if (dropdown.parentElement !== document.body) {
            dropdown.setAttribute('data-original-parent', dropdown.parentElement.id || 'no-id');
            document.body.appendChild(dropdown);
        }

        // Set up positioning
        dropdown.style.zIndex = '9999';
        dropdown.style.position = 'fixed'; // Use fixed to position relative to viewport
        dropdown.style.left = triggerRect.left + 'px';
        dropdown.style.minWidth = '150px';

        // Get dropdown dimensions after positioning
        const dropdownRect = dropdown.getBoundingClientRect();
        const viewportHeight = window.innerHeight;

        // Check if dropdown extends below viewport or pagination area
        const paginationBar = document.querySelector('.pagination, [class*="pagination"], .border-t');
        let bottomThreshold = viewportHeight - 20; // Small bottom margin

        if (paginationBar) {
            const paginationRect = paginationBar.getBoundingClientRect();
            bottomThreshold = Math.min(bottomThreshold, paginationRect.top - 10);
        }

        // Position dropdown above or below trigger
        if (triggerRect.bottom + dropdownRect.height > bottomThreshold) {
            // Position above trigger
            console.log('Positioning dropdown above trigger to avoid clipping');
            dropdown.style.top = (triggerRect.top - dropdownRect.height - 4) + 'px';
            dropdown.classList.add('dropdown-up');
        } else {
            // Position below trigger
            dropdown.style.top = (triggerRect.bottom + 4) + 'px';
            dropdown.classList.remove('dropdown-up');
        }

        // Ensure dropdown doesn't go off-screen horizontally
        if (triggerRect.left + dropdownRect.width > window.innerWidth) {
            dropdown.style.left = (window.innerWidth - dropdownRect.width - 10) + 'px';
        }
    },

    /**
     * Restore dropdown to its original parent when closing
     */
    restoreDropdownToOriginalParent(dropdown) {
        const originalParentId = dropdown.getAttribute('data-original-parent');
        if (originalParentId && originalParentId !== 'no-id' && dropdown.parentElement === document.body) {
            const originalParent = document.getElementById(originalParentId);
            if (originalParent) {
                originalParent.appendChild(dropdown);
                dropdown.removeAttribute('data-original-parent');

                // Reset positioning styles
                dropdown.style.position = '';
                dropdown.style.left = '';
                dropdown.style.top = '';
                dropdown.style.bottom = '';
                dropdown.style.minWidth = '';
                dropdown.style.zIndex = '';
                dropdown.classList.remove('dropdown-up');
            }
        } else if (dropdown.parentElement === document.body && dropdown.hasAttribute('data-original-parent')) {
            // Fallback: if original parent not found, try to find it by dropdown ID pattern
            const dropdownIdMatch = dropdown.id.match(/dropdown-(.+)/);
            if (dropdownIdMatch) {
                // Find any button that toggles this dropdown
                const triggerButton = document.querySelector(`[onclick*="${dropdown.id}"]`);
                if (triggerButton) {
                    const actionContainer = triggerButton.closest('.relative');
                    if (actionContainer) {
                        actionContainer.appendChild(dropdown);
                        dropdown.removeAttribute('data-original-parent');
                        // Reset all positioning styles
                        dropdown.style.position = '';
                        dropdown.style.left = '';
                        dropdown.style.top = '';
                        dropdown.style.bottom = '';
                        dropdown.style.minWidth = '';
                        dropdown.style.zIndex = '';
                        dropdown.classList.remove('dropdown-up');
                    }
                }
            }
        }
    },

    /**
     * Show custom confirmation dialog
     */
    showConfirmDialog(title, message, onConfirm, onCancel = null, confirmText = 'Delete', confirmClass = 'bg-red-600 hover:bg-red-700 focus:ring-red-500') {
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
                <button id="confirm-action" class="px-4 py-2 text-sm font-medium text-white ${confirmClass} rounded-md focus:outline-none focus:ring-2">
                    ${confirmText}
                </button>
            </div>
        `;

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        // Handle button clicks
        const cancelBtn = modal.querySelector('#confirm-cancel');
        const actionBtn = modal.querySelector('#confirm-action');

        const cleanup = () => {
            if (backdrop.parentNode) {
                backdrop.parentNode.removeChild(backdrop);
            }
        };

        cancelBtn.addEventListener('click', () => {
            cleanup();
            if (onCancel) onCancel();
        });

        actionBtn.addEventListener('click', () => {
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

            // Initialize condition builder when edit modal loads
            if (evt.detail.target && evt.detail.target.id === 'modal-content') {
                setTimeout(function() {
                    // Check if this is an edit modal (has conditions textarea with existing content)
                    const conditionsTextarea = document.getElementById('conditions-textarea');
                    if (conditionsTextarea) {
                        const existingConditions = conditionsTextarea.value || conditionsTextarea.textContent || conditionsTextarea.innerHTML;

                        if (existingConditions && existingConditions.trim() !== '' && existingConditions !== 'null') {
                            populateConditionBuilder(existingConditions);
                        }
                    }

                    // Check if this is an add modal (has add_rule_form)
                    const addRuleForm = document.getElementById('add-rule-form');
                    if (addRuleForm) {
                        initializeAddRuleModal();
                    }
                }, 500);
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
                ClaimsApp.utils.restoreDropdownToOriginalParent(dropdown);
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

                    // Preserve enrichment rules filter state and reload
                    setTimeout(() => {
                        console.log('Preserving enrichment rules filter state...');

                        const currentUrl = new URL(window.location.href);
                        currentUrl.searchParams.set('activeTab', 'rules');

                        // Capture current enrichment rules filter values
                        const rulesFilters = document.querySelectorAll('#filters-container input, #filters-container select, #filter-body input, #filter-body select');
                        rulesFilters.forEach(filter => {
                            if (filter.value && filter.name) {
                                currentUrl.searchParams.set(`rules_${filter.name}`, filter.value);
                                console.log(`Preserving rules filter: ${filter.name} = ${filter.value}`);
                            }
                        });

                        console.log('Reloading with preserved rules state:', currentUrl.toString());
                        window.location.href = currentUrl.toString();
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

    // Check if we need to restore a specific tab from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const savedTab = urlParams.get('activeTab');

    if (savedTab) {
        console.log('Restoring tab from URL parameter:', savedTab);

        // Remove the parameter from URL to clean it up
        urlParams.delete('activeTab');
        const cleanUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
        window.history.replaceState({}, '', cleanUrl);

        // Try immediately and with retries
        const attemptTabRestore = (attempt = 1) => {
            if (savedTab === 'rules') {
                console.log(`Attempt ${attempt}: Restoring enrichment rules tab...`);

                // For rules, we don't need to click a tab since it's the default
                // Just restore the filter values and trigger data loading
                setTimeout(() => {
                    console.log('Restoring enrichment rules filter state...');

                    const urlParams = new URLSearchParams(window.location.search);
                    let filtersRestored = false;

                    // Restore enrichment rules filter values
                    urlParams.forEach((value, key) => {
                        if (key.startsWith('rules_')) {
                            const filterName = key.replace('rules_', '');
                            const filterElement = document.querySelector(`#filters-container [name="${filterName}"], #filter-body [name="${filterName}"]`);
                            if (filterElement) {
                                console.log(`Restoring rules filter: ${filterName} = ${value}`);
                                filterElement.value = value;
                                filtersRestored = true;
                            }
                        }
                    });

                    // After restoring filters, trigger data load
                    if (filtersRestored) {
                        setTimeout(() => {
                            const applyButton = document.querySelector('#apply-filters-btn');
                            if (applyButton) {
                                console.log('Triggering rules data load with restored filters...');
                                applyButton.click();
                            }
                        }, 500);
                    }
                }, 500);

            } else if (savedTab === 'price-models') {
                console.log(`Attempt ${attempt}: Restoring price models tab...`);

                // Look for common patterns for price model tabs
                const selectors = [
                    'button[onclick*="showPriceModels"]',
                    'button[onclick*="price"]',
                    'a[onclick*="price"]',
                    '.tab-button:contains("Price")',
                    'button:contains("Price Models")',
                    'button:contains("Price")',
                    '[data-tab="price"]',
                    '[data-target="price"]',
                    '#price-models-tab',
                    '.price-models-btn'
                ];

                let found = false;
                for (const selector of selectors) {
                    try {
                        // Handle :contains() pseudo-selector manually
                        let elements;
                        if (selector.includes(':contains(')) {
                            const baseSelector = selector.split(':contains(')[0];
                            const searchText = selector.match(/contains\("([^"]+)"\)/)?.[1];
                            elements = Array.from(document.querySelectorAll(baseSelector))
                                .filter(el => el.textContent?.includes(searchText));
                        } else {
                            const element = document.querySelector(selector);
                            elements = element ? [element] : [];
                        }

                        if (elements.length > 0) {
                            console.log(`Found price models tab with selector: ${selector}`);
                            elements[0].click();
                            found = true;

                            // After switching to price models tab, wait for it to fully load before triggering data
                            setTimeout(() => {
                                console.log('Checking if price models tab is active...');

                                // Verify price models container is visible
                                const priceModelsContainer = document.querySelector('#price-models-container');
                                const priceFiltersContainer = document.querySelector('#price-filters-container');

                                if (priceModelsContainer && priceFiltersContainer) {
                                    console.log('Price models containers found, restoring filter state...');

                                    // Restore price model filter values from URL parameters
                                    const urlParams = new URLSearchParams(window.location.search);
                                    let filtersRestored = false;

                                    urlParams.forEach((value, key) => {
                                        if (key.startsWith('price_')) {
                                            const filterName = key.replace('price_', '');
                                            const filterElement = document.querySelector(`#price-filters-container [name="${filterName}"]`);
                                            if (filterElement) {
                                                console.log(`Restoring price filter: ${filterName} = ${value}`);
                                                filterElement.value = value;
                                                filtersRestored = true;
                                            }
                                        }
                                    });

                                    // After restoring filters, trigger data load
                                    setTimeout(() => {
                                        console.log('Triggering price models data load with restored filters...');

                                        // Try to find price model filter apply button
                                        const priceFilterApply = document.querySelector('#apply-price-filters-btn');
                                        if (priceFilterApply) {
                                            console.log('Found price filter apply button, clicking...');
                                            priceFilterApply.click();
                                        } else {
                                            // Try direct HTMX request to load price models
                                            const pbmFilter = document.querySelector('#price-filters-container select[name*="pbm_filter"], #price-filters-container select');
                                            if (pbmFilter && pbmFilter.value) {
                                                console.log('Found PBM filter with value:', pbmFilter.value);
                                                console.log('Making direct HTMX request to load price models...');

                                                // Make direct request to price models endpoint with current filter
                                                htmx.ajax('GET', `https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/price-models?pbm_filter=${pbmFilter.value}`, {
                                                    target: '#price-models-container',
                                                    swap: 'innerHTML'
                                                });
                                            } else {
                                                console.log('PBM filter not found or no value, trying default load...');

                                                // Try loading without filters
                                                htmx.ajax('GET', 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/price-models', {
                                                    target: '#price-models-container',
                                                    swap: 'innerHTML'
                                                });
                                            }
                                        }
                                    }, 500); // Wait for filter restoration
                                } else {
                                    console.log('Price models containers not found yet, tab switch may not be complete');
                                }
                            }, 1000); // Increased delay to ensure tab switch completes
                            break;
                        }
                    } catch (e) {
                        // Continue to next selector
                    }
                }

                if (!found && attempt < 3) {
                    // Retry after more delay
                    setTimeout(() => attemptTabRestore(attempt + 1), 300 * attempt);
                } else if (!found) {
                    console.warn('Could not find price models tab after 3 attempts. Available buttons:',
                        Array.from(document.querySelectorAll('button, a, [onclick]'))
                            .filter(el => el.textContent?.toLowerCase().includes('price') ||
                                         el.onclick?.toString().toLowerCase().includes('price'))
                            .map(el => ({
                                text: el.textContent?.trim(),
                                onclick: el.getAttribute('onclick'),
                                id: el.id,
                                className: el.className
                            }))
                    );
                }
            }
        };

        // Start immediately
        attemptTabRestore();
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

    // Check for tab restoration from URL parameter here too
    const urlParams = new URLSearchParams(window.location.search);
    const savedTab = urlParams.get('activeTab');

    if (savedTab === 'price-models') {
        console.log('Restoring tab from URL parameter (immediate):', savedTab);

        // Clean up URL
        urlParams.delete('activeTab');
        const cleanUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
        window.history.replaceState({}, '', cleanUrl);

        setTimeout(() => {
            console.log('Attempting to restore price models tab (immediate)...');

            // Same comprehensive approach
            const selectors = [
                '[onclick*="showPriceModels"]',
                '[onclick*="price"]',
                '[onclick*="Price"]',
                '.tab-button[data-tab="price"]',
                '.tab-button[data-tab="price-models"]',
                '[href*="price"]',
                '.price-tab',
                '#price-tab'
            ];

            let found = false;
            for (const selector of selectors) {
                try {
                    const element = document.querySelector(selector);
                    if (element) {
                        console.log(`Found price models tab (immediate): ${selector}`);
                        element.click();
                        found = true;

                        // After switching to price models tab, trigger data loading
                        setTimeout(() => {
                            console.log('Triggering price models data load (immediate)...');

                            const priceFilterApply = document.querySelector('#apply-price-filters-btn, [onclick*="applyPriceFilters"], [hx-get*="price-models"]');
                            if (priceFilterApply) {
                                console.log('Clicking price filter apply button (immediate)');
                                priceFilterApply.click();
                            } else {
                                const pbmFilter = document.querySelector('#price-filters-container select[name*="pbm"], #price-filters-container select[name*="PBM"]');
                                if (pbmFilter && pbmFilter.value) {
                                    console.log('Triggering PBM filter change (immediate)');
                                    pbmFilter.dispatchEvent(new Event('change', { bubbles: true }));
                                }
                            }
                        }, 500);
                        break;
                    }
                } catch (e) {
                    // Continue
                }
            }

            if (!found && window.showPriceModels) {
                console.log('Calling showPriceModels function (immediate)');
                window.showPriceModels();
            }
        }, 200);
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

// Clinical Modeling Modal Functions
window.openAddClinicalModelModal = function() {
    console.log('Opening add clinical model modal');

    // Prevent background scrolling
    document.body.style.overflow = 'hidden';

    // Load the add clinical model form via HTMX
    htmx.ajax('GET', 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/clinical-models?component=add', {
        target: 'body',
        swap: 'beforeend'
    }).then(() => {
        console.log('Clinical model modal loaded successfully');

        // Focus and show the modal
        const modal = document.getElementById('clinical-model-modal');
        if (modal) {
            modal.focus();
            modal.style.display = 'flex';
            console.log('Modal is now visible');

            // Debug: Check if PBM dropdown has options
            const pbmSelect = modal.querySelector('#pbm');
            if (pbmSelect) {
                console.log('PBM dropdown found with', pbmSelect.options.length, 'options');
                for (let i = 0; i < pbmSelect.options.length; i++) {
                    console.log('PBM option:', pbmSelect.options[i].value, pbmSelect.options[i].text);
                }
            } else {
                console.error('PBM dropdown not found in modal');
            }
        } else {
            console.error('Modal element not found after loading');
        }
    }).catch(error => {
        console.error('Error loading clinical model modal:', error);
        document.body.style.overflow = '';
    });
};

window.closeClinicalModelModal = function() {
    const modal = document.getElementById('clinical-model-modal');
    if (modal) {
        modal.remove();
    }

    // Check if list needs refresh after configure modal actions
    if (window.clinicalModelNeedsRefresh) {
        htmx.ajax('GET', 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/clinical-models', {
            target: '#clinical-models-container',
            swap: 'innerHTML'
        });
        window.clinicalModelNeedsRefresh = false;
    }

    // Restore background scrolling
    document.body.style.overflow = '';
};

// Global modal close function used by configure modal
window.closeModal = function() {
    console.log('🚪 closeModal() called');
    console.log('🔍 Refresh flag status:', window.clinicalModelNeedsRefresh);

    // Try to find and close the rule-modal (used by configure modal)
    const ruleModal = document.getElementById('rule-modal');
    if (ruleModal) {
        console.log('✅ Found rule-modal, closing it');
        ruleModal.classList.remove('show');
        document.body.classList.remove('modal-open');
        // Clear modal content
        const modalContent = document.getElementById('modal-content');
        if (modalContent) {
            modalContent.innerHTML = '';
        }
    } else {
        console.log('⚠️ rule-modal not found');
    }

    // Also check for clinical-model-modal
    const clinicalModal = document.getElementById('clinical-model-modal');
    if (clinicalModal) {
        console.log('✅ Found clinical-model-modal, removing it');
        clinicalModal.remove();
        // Re-enable body scroll
        document.body.style.overflow = 'auto';
    }

    // Check if list needs refresh after configure modal actions
    if (window.clinicalModelNeedsRefresh) {
        console.log('🔄 Refreshing clinical models table...');

        // Get current filter values to preserve them
        const currentFilters = new URLSearchParams();
        const form = document.getElementById('clinical-models-filters');
        if (form) {
            const formData = new FormData(form);
            for (const [key, value] of formData.entries()) {
                if (value.trim() !== '') {
                    currentFilters.append(key, value);
                }
            }
        }

        // Refresh with current filters (similar to delete function)
        const url = currentFilters.toString()
            ? `https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/clinical-models?${currentFilters.toString()}`
            : 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/clinical-models';

        console.log('🌐 Refreshing URL:', url);
        htmx.ajax('GET', url, {
            target: '#clinical-models-container',
            swap: 'innerHTML'
        });
        window.clinicalModelNeedsRefresh = false;
    } else {
        console.log('⏭️ No refresh needed (flag not set)');
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

                    // Maintain price modeling tab after deletion
                    setTimeout(() => {
                        console.log('Refreshing price models after deletion...');

                        // Preserve price models tab and filter state
                        console.log('Preserving price models tab and filter state...');

                        const currentUrl = new URL(window.location.href);
                        currentUrl.searchParams.set('activeTab', 'price-models');

                        // Capture current price model filter values
                        const priceFilters = document.querySelectorAll('#price-filters-container input, #price-filters-container select');
                        priceFilters.forEach(filter => {
                            if (filter.value && filter.name) {
                                currentUrl.searchParams.set(`price_${filter.name}`, filter.value);
                                console.log(`Preserving price filter: ${filter.name} = ${filter.value}`);
                            }
                        });

                        console.log('Reloading with preserved state:', currentUrl.toString());
                        window.location.href = currentUrl.toString();
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

// Make Active Rule function
window.makeActiveRule = function(ruleId) {
    // Show custom confirmation dialog
    ClaimsApp.utils.showConfirmDialog(
        'Reactivate Rule',
        'Are you sure you want to make this rule active? This will restore the rule.',
        function() {
            // Make the rule active via HTMX
            htmx.ajax('POST', `https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/rules?action=makeactive&id=${ruleId}`, {
                target: '#rules-container',
                swap: 'innerHTML'
            }).then(() => {
                ClaimsApp.utils.showNotification('Rule activated successfully! 🎉', 'success');
            }).catch(error => {
                console.error('Make active rule failed:', error);
                ClaimsApp.utils.showNotification('Failed to activate rule. Please try again.', 'error');
            });
        },
        function() {
            // User cancelled - do nothing
        },
        'Make Active',
        'bg-green-600 hover:bg-green-700 focus:ring-green-500'
    );
};

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

// Visual Condition Builder Functions
window.buildCondition = function() {
    const fieldSelect = document.getElementById('field-select');
    const operatorSelect = document.getElementById('operator-select');
    const valueInput = document.getElementById('value-input');

    const field = fieldSelect.value;
    const operator = operatorSelect.value;
    const value = valueInput.value.trim();

    if (!field || !operator || !value) {
        ClaimsApp.utils.showNotification('Please fill in all condition fields', 'error');
        return;
    }

    // Create condition object
    const condition = {
        field: field,
        operator: operator,
        value: value,
        display: `${field} ${operator} ${value}`
    };

    // Add to built conditions
    addConditionToBuilder(condition);

    // Clear inputs
    fieldSelect.value = '';
    operatorSelect.value = '=';
    valueInput.value = '';

    console.log('Added condition:', condition);
};

// Function to add condition to the visual builder
function addConditionToBuilder(condition) {
    const builtConditions = document.getElementById('built-conditions');
    const conditionCount = document.getElementById('condition-count');

    // Create condition element
    const conditionElement = document.createElement('div');
    conditionElement.className = 'flex items-center justify-between bg-blue-50 border border-blue-200 rounded px-3 py-2 mb-2';
    conditionElement.innerHTML = `
        <span class="text-sm font-mono text-blue-900">${condition.display}</span>
        <button type="button" onclick="removeCondition(this)" class="text-red-500 hover:text-red-700">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
        </button>
    `;

    // Store condition data
    conditionElement.setAttribute('data-field', condition.field);
    conditionElement.setAttribute('data-operator', condition.operator);
    conditionElement.setAttribute('data-value', condition.value);

    // If this is the first condition, clear the "no conditions" message
    if (builtConditions.innerHTML.includes('No conditions yet...') ||
        builtConditions.innerHTML.includes('No conditions added yet...')) {
        builtConditions.innerHTML = '';
    }

    builtConditions.appendChild(conditionElement);

    // Update count
    const currentConditions = builtConditions.querySelectorAll('[data-field]');
    conditionCount.textContent = currentConditions.length;

    // Update SQL preview
    updateSQLPreview();
}

// Function to remove a condition
window.removeCondition = function(button) {
    const conditionElement = button.closest('[data-field]');
    conditionElement.remove();

    const builtConditions = document.getElementById('built-conditions');
    const conditionCount = document.getElementById('condition-count');
    const currentConditions = builtConditions.querySelectorAll('[data-field]');

    // Update count
    conditionCount.textContent = currentConditions.length;

    // Show "no conditions" message if empty
    if (currentConditions.length === 0) {
        builtConditions.innerHTML = '<span class="text-gray-500 text-sm">No conditions added yet...</span>';
    }

    // Update SQL preview
    updateSQLPreview();
};

// Function to update SQL preview (only for newly built conditions)
function updateSQLPreview() {
    const builtConditions = document.getElementById('built-conditions');
    const sqlPreviewSimple = document.getElementById('final-sql-preview');
    const sqlPreviewComplex = document.getElementById('sql-preview');
    const conditions = builtConditions.querySelectorAll('[data-field]');

    // Only show SQL preview if there are newly built conditions
    if (conditions.length === 0) {
        if (sqlPreviewSimple) sqlPreviewSimple.textContent = '';
        if (sqlPreviewComplex) sqlPreviewComplex.textContent = '';
        return;
    }

    // Build SQL WHERE clause for newly built conditions
    let sqlParts = [];
    conditions.forEach(condition => {
        const field = condition.getAttribute('data-field');
        const operator = condition.getAttribute('data-operator');
        let value = condition.getAttribute('data-value');

        // Format value based on operator
        if (operator === 'IN' || operator === 'NOT IN') {
            const values = value.split(',').map(v => `'${v.trim()}'`).join(', ');
            value = `(${values})`;
        } else if (operator === 'LIKE' || operator === 'NOT LIKE') {
            value = `'%${value}%'`;
        } else {
            value = `'${value}'`;
        }

        sqlParts.push(`${field} ${operator} ${value}`);
    });

    const sql = sqlParts.join(' AND ');

    // Update SQL preview areas
    if (sqlPreviewSimple) sqlPreviewSimple.textContent = sql;
    if (sqlPreviewComplex) sqlPreviewComplex.textContent = sql;

    // Update the hidden conditions textarea
    updateConditionsTextarea(sql);
}

// Complex rule builder functions (simplified approach)
window.addFlag = function() {
    const flagSelector = document.getElementById('flag-selector');
    const expressionBuilder = document.getElementById('expression-builder');

    if (!flagSelector || !expressionBuilder) return;

    const selectedFlag = flagSelector.value;
    if (!selectedFlag) {
        ClaimsApp.utils.showNotification('Please select a flag first', 'warning');
        return;
    }

    // Add flag to expression builder
    addElementToExpression(selectedFlag, 'flag');
    flagSelector.value = ''; // Reset selector
};

window.addOperator = function(operator) {
    addElementToExpression(operator, 'operator');
};

window.addParenthesis = function(paren) {
    addElementToExpression(paren, 'parenthesis');
};

window.clearExpression = function() {
    const expressionBuilder = document.getElementById('expression-builder');
    if (expressionBuilder) {
        expressionBuilder.innerHTML = '<span id="empty-hint" class="text-blue-500 text-sm">Add flags below to build your expression...</span>';
    }

    // Clear SQL preview
    const sqlPreview = document.getElementById('sql-preview');
    if (sqlPreview) {
        sqlPreview.textContent = '';
    }

    // Clear conditions textarea
    updateConditionsTextarea('');
};

// Helper function to add elements to complex expression builder
function addElementToExpression(element, type) {
    const expressionBuilder = document.getElementById('expression-builder');
    if (!expressionBuilder) return;

    // Remove empty hint if it exists
    const emptyHint = document.getElementById('empty-hint');
    if (emptyHint) {
        emptyHint.remove();
    }

    // Create element span
    const elementSpan = document.createElement('span');
    elementSpan.className = getElementClass(type);
    elementSpan.innerHTML = `${element} <button onclick="removeExpressionElement(this)" class="ml-1 text-red-500 hover:text-red-700">&times;</button>`;

    expressionBuilder.appendChild(elementSpan);

    // Update SQL preview
    updateComplexRuleSQL();
}

// Helper function to get CSS classes for different element types
function getElementClass(type) {
    switch(type) {
        case 'flag': return 'inline-flex items-center bg-green-100 text-green-800 px-2 py-1 rounded text-sm mr-1 mb-1';
        case 'operator': return 'inline-flex items-center bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm mr-1 mb-1';
        case 'parenthesis': return 'inline-flex items-center bg-gray-100 text-gray-800 px-2 py-1 rounded text-sm mr-1 mb-1';
        default: return 'inline-flex items-center bg-gray-100 text-gray-700 px-2 py-1 rounded text-sm mr-1 mb-1';
    }
}

// Function to remove elements from expression
window.removeExpressionElement = function(button) {
    const element = button.parentElement;
    element.remove();

    // Check if expression is empty and add hint back
    const expressionBuilder = document.getElementById('expression-builder');
    if (expressionBuilder && expressionBuilder.children.length === 0) {
        expressionBuilder.innerHTML = '<span id="empty-hint" class="text-blue-500 text-sm">Add flags below to build your expression...</span>';
    }

    updateComplexRuleSQL();
};

// Function to update SQL preview for complex rules
function updateComplexRuleSQL() {
    const expressionBuilder = document.getElementById('expression-builder');
    const sqlPreview = document.getElementById('sql-preview');

    if (!expressionBuilder || !sqlPreview) return;

    // Get all elements except the empty hint
    const elements = Array.from(expressionBuilder.children).filter(child => child.id !== 'empty-hint');

    if (elements.length === 0) {
        sqlPreview.textContent = '';
        updateConditionsTextarea('');
        return;
    }

    // Build expression from elements (simplified)
    const expression = elements.map(el => el.textContent.replace('×', '').trim()).join(' ');

    sqlPreview.textContent = expression;
    updateConditionsTextarea(expression);
}

window.clearAllConditions = function() {
    console.log('Clear all conditions function called');

    // Clear built conditions
    const builtConditions = document.getElementById('built-conditions');
    const conditionCount = document.getElementById('condition-count');
    const sqlPreview = document.getElementById('final-sql-preview');

    if (builtConditions) {
        builtConditions.innerHTML = '<span class="text-gray-500 text-sm">No conditions added yet...</span>';
    }

    if (conditionCount) {
        conditionCount.textContent = '0';
    }

    if (sqlPreview) {
        sqlPreview.textContent = 'No conditions defined';
    }

    // Clear the conditions textarea
    updateConditionsTextarea('');

    // Clear input fields
    const fieldSelect = document.getElementById('field-select');
    const operatorSelect = document.getElementById('operator-select');
    const valueInput = document.getElementById('value-input');

    if (fieldSelect) fieldSelect.value = '';
    if (operatorSelect) operatorSelect.value = '=';
    if (valueInput) valueInput.value = '';
};

// Function to initialize edit modal condition builder (called directly from modal)
window.initializeEditModalConditionBuilder = function() {
    setTimeout(function() {
        const conditionsTextarea = document.getElementById('conditions-textarea');
        if (conditionsTextarea) {
            const existingConditions = conditionsTextarea.value || conditionsTextarea.textContent || conditionsTextarea.innerHTML;
            if (existingConditions && existingConditions.trim() !== '' && existingConditions !== 'null') {
                populateConditionBuilder(existingConditions);
            }
        }
    }, 100);
};

// Function to initialize add rule modal with defaults
window.initializeAddRuleModal = function() {
    // Set current date as effective from date
    const effectiveFromInput = document.getElementById('add_effective_from');
    if (effectiveFromInput) {
        const currentDate = new Date().toISOString().split('T')[0];
        effectiveFromInput.value = currentDate;
    }

    // Generate priority based on rule type when rule type changes
    const ruleTypeSelect = document.querySelector('#add-rule-form select[name="rule_type"]');
    const priorityInput = document.getElementById('add_priority');

    function updatePriorityBasedOnRuleType() {
        if (ruleTypeSelect && priorityInput) {
            const ruleType = ruleTypeSelect.value;
            let priority;

            if (ruleType === 'SIMPLE') {
                // Random priority less than 800 (100-799)
                priority = Math.floor(Math.random() * 700) + 100;
            } else if (ruleType === 'COMPLEX') {
                // Random priority greater than 800 (801-1000)
                priority = Math.floor(Math.random() * 200) + 801;
            } else {
                // Default fallback
                priority = 500;
            }

            priorityInput.value = priority;
        }
    }

    // Set initial priority
    updatePriorityBasedOnRuleType();

    // Update priority when rule type changes
    if (ruleTypeSelect) {
        ruleTypeSelect.addEventListener('change', updatePriorityBasedOnRuleType);
    }
};

// Function to show existing conditions when editing a rule
window.populateConditionBuilder = function(conditionsSQL) {
    if (!conditionsSQL || conditionsSQL.trim() === '') {
        return;
    }

    // Show existing condition in simple rule builder
    const builtConditions = document.getElementById('built-conditions');
    if (builtConditions) {
        builtConditions.innerHTML = `
            <div class="bg-blue-50 border border-blue-200 rounded px-3 py-2">
                <div class="text-xs text-blue-600 mb-1">Current Rule Condition:</div>
                <div class="text-sm font-mono text-blue-900">${conditionsSQL}</div>
            </div>
        `;
    }

    // Show existing condition in complex rule builder
    const expressionBuilder = document.getElementById('expression-builder');
    if (expressionBuilder) {
        expressionBuilder.innerHTML = `
            <div class="bg-blue-50 border border-blue-200 rounded px-3 py-2 w-full">
                <div class="text-xs text-blue-600 mb-1">Current Rule Expression:</div>
                <div class="text-sm font-mono text-blue-900">${conditionsSQL}</div>
            </div>
        `;
    }

    // Update the conditions textarea so the form has the existing condition
    updateConditionsTextarea(conditionsSQL);
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

// ==================== CLINICAL MODEL FUNCTIONS ====================

// Global toggleDropdown function for clinical models
window.toggleDropdown = function(dropdownId) {
    // Close all other dropdowns first
    document.querySelectorAll('[id^="clinical-dropdown-"]').forEach(dropdown => {
        if (dropdown.id !== dropdownId) {
            dropdown.classList.add('hidden');
        }
    });

    // Toggle the clicked dropdown
    const dropdown = document.getElementById(dropdownId);
    if (dropdown) {
        const isHidden = dropdown.classList.contains('hidden');
        dropdown.classList.toggle('hidden');

        if (!isHidden) {
            // Being hidden, reset positioning
            dropdown.classList.remove('bottom-full', 'mb-2');
            dropdown.classList.add('mt-2');
        } else {
            // Being shown, check positioning
            setTimeout(() => {
                const rect = dropdown.getBoundingClientRect();
                const viewportHeight = window.innerHeight;

                // If dropdown would overflow bottom of viewport, position it above
                if (rect.bottom > viewportHeight - 20) {
                    dropdown.classList.remove('mt-2');
                    dropdown.classList.add('bottom-full', 'mb-2');
                }
            }, 10);
        }
    }
};

// Clinical Model Action Functions
window.configureClinicalModel = function(modelId) {
    console.log('⚙️ Configure clinical model:', modelId);
    // Close dropdown
    const dropdown = document.getElementById(`clinical-dropdown-${modelId}`);
    if (dropdown) dropdown.classList.add('hidden');

    // Close any other dropdowns first
    document.querySelectorAll('[id^="clinical-dropdown-"]').forEach(dropdown => {
        dropdown.classList.add('hidden');
    });

    // Set flag to always refresh when configure modal is opened
    // This ensures table refreshes when modal closes to show any changes
    window.clinicalModelNeedsRefresh = true;
    console.log('✅ Set refresh flag to true');

    const modal = document.getElementById('rule-modal');
    const modalContent = document.getElementById('modal-content');

    // Clear previous content first
    if (modalContent) {
        console.log('🧹 Clearing previous modal content for configure');
        modalContent.innerHTML = `
            <div class="p-8 text-center">
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p class="text-gray-600">Loading model configuration...</p>
            </div>
        `;
    }

    if (modal) {
        modal.classList.add('show');
        // Prevent background scroll
        document.body.classList.add('modal-open');
        document.body.style.overflow = 'hidden';
    }

    // Load the configure model form
    htmx.ajax('GET', `https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/clinical-models?component=configure&id=${modelId}`, {
        target: '#modal-content',
        swap: 'innerHTML'
    }).then(() => {
        console.log('✅ Configure model form loaded successfully');
    }).catch((error) => {
        console.error('❌ Failed to load configure model form:', error);
        if (modalContent) {
            modalContent.innerHTML = `
                <div class="p-8 text-center text-red-600">
                    <p>Failed to load model configuration. Please try again.</p>
                    <button onclick="closeModal()" class="mt-4 px-4 py-2 bg-gray-500 text-white rounded">Close</button>
                </div>
            `;
        }
    });
};

window.viewClinicalModel = function(modelId) {
    console.log('View clinical model NDCs:', modelId);
    // Close dropdown
    const dropdown = document.getElementById(`clinical-dropdown-${modelId}`);
    if (dropdown) dropdown.classList.add('hidden');

    // TODO: Implement view NDCs functionality
    ClaimsApp.utils.showNotification('View NDCs functionality coming soon...', 'info');
};

window.activateClinicalModel = function(modelId) {
    console.log('Activate clinical model:', modelId);
    // Close dropdown
    const dropdown = document.getElementById(`clinical-dropdown-${modelId}`);
    if (dropdown) dropdown.classList.add('hidden');

    if (confirm('Are you sure you want to activate this clinical model?')) {
        // Make HTMX request to activate
        htmx.ajax('POST', `https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/clinical-models?action=activate&id=${modelId}`, {
            target: '#clinical-models-container',
            swap: 'innerHTML'
        }).then(() => {
            ClaimsApp.utils.showNotification('Clinical model activated successfully!', 'success');
        }).catch(() => {
            ClaimsApp.utils.showNotification('Failed to activate clinical model.', 'error');
        });
    }
};

window.deactivateClinicalModel = function(modelId) {
    console.log('Deactivate clinical model:', modelId);
    // Close dropdown
    const dropdown = document.getElementById(`clinical-dropdown-${modelId}`);
    if (dropdown) dropdown.classList.add('hidden');

    if (confirm('Are you sure you want to deactivate this clinical model?')) {
        // Make HTMX request to deactivate
        htmx.ajax('POST', `https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/clinical-models?action=deactivate&id=${modelId}`, {
            target: '#clinical-models-container',
            swap: 'innerHTML'
        }).then(() => {
            ClaimsApp.utils.showNotification('Clinical model deactivated successfully!', 'success');
        }).catch(() => {
            ClaimsApp.utils.showNotification('Failed to deactivate clinical model.', 'error');
        });
    }
};

window.executeClinicalModel = function(modelId) {
    console.log('Execute clinical model:', modelId);
    // Close dropdown
    const dropdown = document.getElementById(`clinical-dropdown-${modelId}`);
    if (dropdown) dropdown.classList.add('hidden');

    if (confirm('Are you sure you want to execute this clinical model? This will run all queries and update the results.')) {
        ClaimsApp.utils.showNotification('Executing clinical model...', 'info');

        // TODO: Make HTMX request to execute model
        htmx.ajax('POST', `https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/clinical-models?action=execute&id=${modelId}`, {
            target: '#clinical-models-container',
            swap: 'innerHTML'
        }).then(() => {
            ClaimsApp.utils.showNotification('Clinical model executed successfully!', 'success');
        }).catch(() => {
            ClaimsApp.utils.showNotification('Failed to execute clinical model.', 'error');
        });
    }
};

window.deleteClinicalModel = function(modelId) {
    console.log('Delete clinical model:', modelId);

    // Close dropdown
    const dropdown = document.getElementById(`clinical-dropdown-${modelId}`);
    if (dropdown) dropdown.classList.add('hidden');

    // Use custom confirmation dialog like price models
    ClaimsApp.utils.showConfirmDialog(
        'Confirm Deletion',
        'Are you sure you want to delete this clinical model? This action cannot be undone.',
        () => {
            console.log('User confirmed deletion for model:', modelId);

            // Send delete request via fetch instead of HTMX to avoid targeting issues
            fetch(`https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/clinical-models?action=delete&id=${modelId}`, {
                method: 'POST'
            })
            .then(response => response.json())
            .then(data => {
                console.log('Clinical model delete request completed successfully');

                if (data.success) {
                    // Show success notification
                    ClaimsApp.utils.showNotification('Clinical model deleted successfully!', 'success');

                    // Refresh the clinical models table while preserving filters
                    setTimeout(() => {
                        console.log('Refreshing clinical models after deletion...');

                        // Get current filter values to preserve them
                        const currentFilters = new URLSearchParams();
                        const form = document.getElementById('clinical-models-filters');
                        if (form) {
                            const formData = new FormData(form);
                            for (const [key, value] of formData.entries()) {
                                if (value.trim() !== '') {
                                    currentFilters.append(key, value);
                                }
                            }
                        }

                        // Refresh with current filters
                        const url = `https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/clinical-models?${currentFilters.toString()}`;
                        htmx.ajax('GET', url, {
                            target: '#clinical-models-container',
                            swap: 'innerHTML'
                        });
                    }, 500);
                } else {
                    throw new Error(data.message || 'Delete failed');
                }
            })
            .catch((error) => {
                console.error('Failed to delete clinical model:', error);
                ClaimsApp.utils.showNotification('Failed to delete clinical model. Please try again.', 'error');
            });
        },
        () => {
            console.log('User cancelled clinical model deletion');
        }
    );
};

// Clone clinical model function
window.cloneClinicalModel = function(modelId) {
    console.log('🔄 Clone clinical model:', modelId);

    // Close dropdown
    const dropdown = document.getElementById(`clinical-dropdown-${modelId}`);
    if (dropdown) dropdown.classList.add('hidden');

    // Close any other dropdowns first
    document.querySelectorAll('[id^="clinical-dropdown-"]').forEach(dropdown => {
        dropdown.classList.add('hidden');
    });

    // Set flag to refresh when modal closes (clone creates new model in DB)
    window.clinicalModelNeedsRefresh = true;
    console.log('✅ Set refresh flag to true');

    const modal = document.getElementById('rule-modal');
    const modalContent = document.getElementById('modal-content');

    // Show loading spinner
    if (modalContent) {
        console.log('🧹 Clearing previous modal content for clone');
        modalContent.innerHTML = `
            <div class="p-8 text-center">
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p class="text-gray-600">Cloning model...</p>
            </div>
        `;
    }

    // Show modal
    if (modal) {
        modal.classList.add('show');
        document.body.classList.add('modal-open');
        document.body.style.overflow = 'hidden';
    }

    // Clone the model (creates DB copy) and load configure modal
    htmx.ajax('GET', `https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/clinical-models?component=clone&id=${modelId}`, {
        target: '#modal-content',
        swap: 'innerHTML'
    }).then(() => {
        console.log('✅ Model cloned and configure modal loaded successfully');
    }).catch((error) => {
        console.error('❌ Failed to clone model:', error);
        if (modalContent) {
            modalContent.innerHTML = `
                <div class="p-8 text-center text-red-600">
                    <p>Failed to clone model. Please try again.</p>
                    <button onclick="closeModal()" class="mt-4 px-4 py-2 bg-gray-500 text-white rounded">Close</button>
                </div>
            `;
        }
    });
};

// Activate clinical model function
window.activateClinicalModel = function(modelId) {
    console.log('Activate clinical model:', modelId);

    // Close dropdown
    const dropdown = document.getElementById(`clinical-dropdown-${modelId}`);
    if (dropdown) dropdown.classList.add('hidden');

    // Use custom confirmation dialog like delete
    ClaimsApp.utils.showConfirmDialog(
        'Confirm Activation',
        'Are you sure you want to activate this clinical model? This will make it available for use.',
        () => {
            console.log('User confirmed activation for model:', modelId);

            // Send activate request via fetch
            fetch(`https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/clinical-models?action=activate&id=${modelId}`, {
                method: 'POST'
            })
            .then(response => response.json())
            .then(data => {
                console.log('Clinical model activate request completed successfully');

                if (data.success) {
                    // Show success notification
                    ClaimsApp.utils.showNotification('Clinical model activated successfully!', 'success');

                    // Refresh the clinical models table while preserving filters
                    setTimeout(() => {
                        console.log('Refreshing clinical models after activation...');

                        // Get current filter values to preserve them
                        const currentFilters = new URLSearchParams();
                        const form = document.getElementById('clinical-models-filters');
                        if (form) {
                            const formData = new FormData(form);
                            for (const [key, value] of formData.entries()) {
                                if (value.trim() !== '') {
                                    currentFilters.append(key, value);
                                }
                            }
                        }

                        // Refresh with current filters
                        const url = `https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/clinical-models?${currentFilters.toString()}`;
                        htmx.ajax('GET', url, {
                            target: '#clinical-models-container',
                            swap: 'innerHTML'
                        });
                    }, 500);
                } else {
                    throw new Error(data.message || 'Activation failed');
                }
            })
            .catch((error) => {
                console.error('Failed to activate clinical model:', error);
                ClaimsApp.utils.showNotification('Failed to activate clinical model. Please try again.', 'error');
            });
        },
        () => {
            console.log('User cancelled clinical model activation');
        },
        'Activate',  // confirmText
        'bg-green-600 hover:bg-green-700 focus:ring-green-500'  // confirmClass
    );
};

// Clinical Model Modal Functions (using existing modal system)
window.openAddClinicalModelModal = function() {
    console.log('Opening add clinical model modal...');

    // Close any open dropdowns first
    document.querySelectorAll('[id^="clinical-dropdown-"]').forEach(dropdown => {
        dropdown.classList.add('hidden');
    });

    const modal = document.getElementById('rule-modal');
    const modalContent = document.getElementById('modal-content');

    // Clear previous content first
    if (modalContent) {
        console.log('🧹 Clearing previous modal content');
        modalContent.innerHTML = `
            <div class="p-8 text-center">
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p class="text-gray-600">Loading clinical model form...</p>
            </div>
        `;
    }

    if (modal) {
        modal.classList.add('show');
        // Prevent background scroll
        document.body.classList.add('modal-open');
        document.body.style.overflow = 'hidden';
    }

    // Load the add clinical model form
    htmx.ajax('GET', 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/clinical-models?component=add', {
        target: '#modal-content',
        swap: 'innerHTML'
    }).then(() => {
        console.log('✅ Clinical model form loaded successfully');
    }).catch((error) => {
        console.error('❌ Failed to load clinical model form:', error);
        if (modalContent) {
            modalContent.innerHTML = `
                <div class="p-8 text-center text-red-600">
                    <p>Failed to load clinical model form. Please try again.</p>
                    <button onclick="closeModal()" class="mt-4 px-4 py-2 bg-gray-500 text-white rounded">Close</button>
                </div>
            `;
        }
    });
};


// Note: Modal close functionality is handled by the existing modal system in modal.js

// Close all dropdowns when clicking outside
document.addEventListener('click', function(event) {
    // Check if click is outside any dropdown
    if (!event.target.closest('.relative')) {
        document.querySelectorAll('[id^="clinical-dropdown-"]').forEach(dropdown => {
            dropdown.classList.add('hidden');
        });
    }
});

// Clinical Models Filter Functions
window.applyClinicalModelFilters = function() {
    const form = document.getElementById('clinical-models-filters');
    const formData = new FormData(form);

    // Build query parameters
    const params = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
        if (value.trim() !== '') {
            params.append(key, value);
        }
    }

    // Make HTMX request with filters
    const url = `https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/clinical-models?${params.toString()}`;

    htmx.ajax('GET', url, {
        target: '#clinical-models-container',
        swap: 'innerHTML'
    });
};

window.clearClinicalModelFilters = function() {
    // Reset form
    document.getElementById('clinical-models-filters').reset();

    // Apply empty filters (reload all models)
    htmx.ajax('GET', 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/clinical-models', {
        target: '#clinical-models-container',
        swap: 'innerHTML'
    });
};

// Debounced search function
let searchTimeout;
window.debounceSearch = function(searchTerm) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        applyClinicalModelFilters();
    }, 500); // Wait 500ms after user stops typing
};

// ============================================================================
// RFP Reports Functions
// ============================================================================

// Open Create Report Modal
window.openCreateReportModal = function() {
    console.log('📋 Opening create RFP report modal...');

    const modal = document.getElementById('rule-modal');
    const modalContent = document.getElementById('modal-content');

    // Show loading spinner
    if (modalContent) {
        modalContent.innerHTML = `
            <div class="p-8 text-center">
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p class="text-gray-600">Loading report form...</p>
            </div>
        `;
    }

    // Show modal
    if (modal) {
        modal.classList.add('show');
        document.body.classList.add('modal-open');
        document.body.style.overflow = 'hidden';
    }

    // Load create report modal
    htmx.ajax('GET', 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/rfp-reports?component=create-report', {
        target: '#modal-content',
        swap: 'innerHTML'
    }).then(() => {
        console.log('✅ Create report modal loaded successfully');
    }).catch((error) => {
        console.error('❌ Failed to load create report modal:', error);
        if (modalContent) {
            modalContent.innerHTML = `
                <div class="p-8 text-center text-red-600">
                    <p>Failed to load report form. Please try again.</p>
                    <button onclick="closeModal()" class="mt-4 px-4 py-2 bg-gray-500 text-white rounded">Close</button>
                </div>
            `;
        }
    });
};

// Compare Reports (placeholder)
window.compareRFPReports = function() {
    const checkboxes = document.querySelectorAll('#rfp-reports-tbody input[type="checkbox"]:checked');
    const reportIds = Array.from(checkboxes).map(cb => cb.value);

    if (reportIds.length < 2) {
        ClaimsApp.utils.showNotification('Please select at least 2 reports to compare', 'warning');
        return;
    }

    console.log('📊 Comparing reports:', reportIds);
    ClaimsApp.utils.showNotification('Report comparison coming soon!', 'info');
};

// Price Book functionality
ClaimsApp.priceBook = {
    /**
     * Show add price book modal
     */
    showAddModal() {
        console.log('📖 Opening add price book modal');
        const modal = document.getElementById('rule-modal');
        const modalContent = document.getElementById('modal-content');

        if (!modal || !modalContent) {
            console.error('Modal elements not found');
            return;
        }

        // Load the add modal template
        fetch('https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/price-book?component=add')
            .then(response => response.text())
            .then(html => {
                modalContent.innerHTML = html;
                modal.classList.add('show');
                document.body.classList.add('modal-open');
            })
            .catch(error => {
                console.error('Failed to load add modal:', error);
                ClaimsApp.utils.showNotification('Failed to load form', 'error');
            });
    },

    /**
     * Show edit price book modal
     */
    showEditModal(configId) {
        console.log('✏️ Opening edit price book modal for:', configId);
        const modal = document.getElementById('rule-modal');
        const modalContent = document.getElementById('modal-content');

        if (!modal || !modalContent) {
            console.error('Modal elements not found');
            return;
        }

        // Load the edit modal template
        fetch(`https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/price-book?edit=${configId}`)
            .then(response => response.text())
            .then(html => {
                modalContent.innerHTML = html;
                modal.classList.add('show');
                document.body.classList.add('modal-open');
            })
            .catch(error => {
                console.error('Failed to load edit modal:', error);
                ClaimsApp.utils.showNotification('Failed to load form', 'error');
            });
    },

    /**
     * View price book details
     */
    viewDetails(configId) {
        console.log('👁️ Viewing price book details:', configId);
        ClaimsApp.utils.showNotification('View details coming soon!', 'info');
    },

    /**
     * Delete price book configuration
     */
    deleteConfig(configId) {
        if (!confirm('Are you sure you want to delete this price book configuration?')) {
            return;
        }

        console.log('🗑️ Deleting price book:', configId);

        fetch(`https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/price-book?action=delete&id=${configId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        })
        .then(response => response.text())
        .then(html => {
            // Show notification
            const notification = document.getElementById('notification');
            if (notification) {
                notification.innerHTML = html;
            }

            // Refresh the list
            setTimeout(() => {
                this.refreshList();
            }, 1000);
        })
        .catch(error => {
            console.error('Failed to delete price book:', error);
            ClaimsApp.utils.showNotification('Failed to delete price book', 'error');
        });
    },

    /**
     * Refresh price book list
     */
    refreshList() {
        console.log('🔄 Refreshing price book list');
        const container = document.getElementById('price-book-container');
        if (container) {
            htmx.trigger(container, 'load');
        }
    },

    /**
     * Load additional parameters based on PBM selection
     */
    loadAdditionalParameters(pbmCode) {
        console.log('📋 Loading additional parameters for PBM:', pbmCode);

        if (!pbmCode) {
            const container = document.getElementById('additional-parameters-container');
            if (container) {
                container.innerHTML = '<div class="text-center text-gray-500 py-8"><p>Select a PBM to load additional parameters</p></div>';
            }
            return;
        }

        fetch(`https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/price-book?get_parameters=true&pbm_code=${pbmCode}`)
            .then(response => response.json())
            .then(parameters => {
                this.renderAdditionalParameters(parameters);
            })
            .catch(error => {
                console.error('Failed to load parameters:', error);
                ClaimsApp.utils.showNotification('Failed to load additional parameters', 'error');
            });
    },

    /**
     * Render additional parameters form fields
     */
    renderAdditionalParameters(parameters) {
        const container = document.getElementById('additional-parameters-container');
        if (!container) return;

        if (parameters.length === 0) {
            container.innerHTML = '<div class="text-center text-gray-500 py-8"><p>No additional parameters available</p></div>';
            return;
        }

        const html = parameters.map(param => {
            // Handle validation_rules - might be string or object
            let validationRules = {};
            if (param.validation_rules) {
                if (typeof param.validation_rules === 'string') {
                    validationRules = JSON.parse(param.validation_rules);
                } else {
                    validationRules = param.validation_rules;
                }
            }

            const fieldType = validationRules.field_type || 'dropdown';

            // Handle valid_values - might be string or array
            let validValues = [];
            if (param.valid_values) {
                if (typeof param.valid_values === 'string') {
                    validValues = JSON.parse(param.valid_values);
                } else {
                    validValues = param.valid_values;
                }
            }

            if (fieldType === 'dropdown') {
                const options = validValues.map(val =>
                    `<option value="${val.code}" ${val.is_default ? 'selected' : ''}>${val.label}</option>`
                ).join('');

                return `
                    <div>
                        <label for="param_${param.parameter_code}" class="block text-sm font-medium text-gray-700 mb-1">
                            ${param.parameter_name}
                            ${validationRules.required ? '<span class="text-red-500">*</span>' : ''}
                        </label>
                        <select id="param_${param.parameter_code}" name="param_${param.parameter_code}"
                                ${validationRules.required ? 'required' : ''}
                                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                            ${options}
                        </select>
                        ${param.parameter_description ? `<p class="mt-1 text-xs text-gray-500">${param.parameter_description}</p>` : ''}
                    </div>
                `;
            } else if (fieldType === 'boolean') {
                const options = validValues.map(val =>
                    `<option value="${val.code}" ${val.is_default ? 'selected' : ''}>${val.label}</option>`
                ).join('');

                return `
                    <div>
                        <label for="param_${param.parameter_code}" class="block text-sm font-medium text-gray-700 mb-1">
                            ${param.parameter_name}
                        </label>
                        <select id="param_${param.parameter_code}" name="param_${param.parameter_code}"
                                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                            ${options}
                        </select>
                    </div>
                `;
            }

            return '';
        }).join('');

        container.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">${html}</div>`;
    },

    /**
     * Toggle additional parameters section
     */
    toggleAdditionalParameters() {
        const container = document.getElementById('additional-parameters-container');
        const chevron = document.getElementById('additional-params-chevron');

        if (!container || !chevron) return;

        if (container.classList.contains('hidden')) {
            container.classList.remove('hidden');
            chevron.classList.add('rotate-180');
        } else {
            container.classList.add('hidden');
            chevron.classList.remove('rotate-180');
        }
    },

    /**
     * Open pricing builder (placeholder for now)
     */
    openPricingBuilder() {
        console.log('💰 Opening pricing builder');
        ClaimsApp.utils.showNotification('Pricing builder coming soon! For now, pricing structure will be saved as empty.', 'info');
    }
};

// Listen for price book events
document.body.addEventListener('priceBookCreated', function() {
    console.log('✅ Price book created event received');
    ClaimsApp.priceBook.refreshList();
    ClaimsApp.modal.close();
});

document.body.addEventListener('priceBookUpdated', function() {
    console.log('✅ Price book updated event received');
    ClaimsApp.priceBook.refreshList();
    ClaimsApp.modal.close();
});

document.body.addEventListener('priceBookDeleted', function() {
    console.log('✅ Price book deleted event received');
    ClaimsApp.priceBook.refreshList();
});

console.log('🚀 ClaimsApp utilities loaded');