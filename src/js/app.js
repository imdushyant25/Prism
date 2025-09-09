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
    }
};

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
});

// Action handlers for rules
ClaimsApp.actions = {
    editRule(ruleId) {
        console.log('Edit rule:', ruleId);
        ClaimsApp.modal.openEditModal(ruleId);
    },

    cloneRule(ruleId) {
        console.log('Clone rule:', ruleId);
        ClaimsApp.utils.showNotification('Clone functionality coming soon!', 'info');
    },

    modelRule(ruleId) {
        console.log('Create model from rule:', ruleId);
        ClaimsApp.utils.showNotification('Model creation functionality coming soon!', 'info');
    },

    deleteRule(ruleId) {
        if (confirm('Are you sure you want to delete this rule?')) {
            console.log('Delete rule:', ruleId);
            ClaimsApp.utils.showNotification('Delete functionality coming soon!', 'warning');
        }
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
        // Add change listeners for real-time badge updates and auto-apply
        document.querySelectorAll('#filter-body select, #filter-body input').forEach(input => {
            input.addEventListener('change', () => {
                this.updateFilterBadges();
                // Auto-apply filters on change (but with clean data)
                this.applyFilters();
            });
            
            input.addEventListener('keyup', () => {
                this.updateFilterBadges();
                // Debounced auto-apply for text inputs
                if (input.type === 'text' || input.type === 'search') {
                    clearTimeout(input.debounceTimer);
                    input.debounceTimer = setTimeout(() => {
                        this.applyFilters();
                    }, 500);
                }
            });
        });
        
        // Start with filters collapsed
        const body = document.getElementById('filter-body');
        if (body) {
            body.classList.add('collapse');
        }
    }
};

// Initialize filters when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Initialize filters if they exist
    if (document.getElementById('filter-body')) {
        ClaimsApp.filters.initializeFilters();
    }
});

// Make functions globally available for onclick handlers
window.showNotification = ClaimsApp.utils.showNotification;
window.toggleDropdown = ClaimsApp.utils.toggleDropdown;
window.editRule = ClaimsApp.actions.editRule;
window.cloneRule = ClaimsApp.actions.cloneRule;
window.modelRule = ClaimsApp.actions.modelRule;
window.deleteRule = ClaimsApp.actions.deleteRule;

// Filter functions
window.updateFilterBadges = ClaimsApp.filters.updateFilterBadges.bind(ClaimsApp.filters);
window.clearFilter = ClaimsApp.filters.clearFilter.bind(ClaimsApp.filters);
window.clearAllFilters = ClaimsApp.filters.clearAllFilters.bind(ClaimsApp.filters);
window.applyFilters = ClaimsApp.filters.applyFilters.bind(ClaimsApp.filters);
window.toggleFilters = ClaimsApp.filters.toggleFilters.bind(ClaimsApp.filters);
window.applyQuickFilter = ClaimsApp.filters.applyQuickFilter.bind(ClaimsApp.filters);

console.log('🚀 ClaimsApp utilities loaded');