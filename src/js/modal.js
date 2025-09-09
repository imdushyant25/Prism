/**
 * Modal Management System
 * Handles opening, closing, and state management for rule edit modals
 */

ClaimsApp.modal = {
    /**
     * Open edit modal for a rule
     */
    openEditModal(ruleId) {
        // Close any open dropdowns first
        document.querySelectorAll('[id^="dropdown-"]').forEach(dropdown => {
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
                    <p class="text-gray-600">Loading rule editor...</p>
                </div>
            `;
        }
        
        if (modal) {
            modal.classList.add('show');
            // Prevent background scroll
            document.body.classList.add('modal-open');
            document.body.style.overflow = 'hidden';
        }
        
        // Clear any existing modal state
        if (window.modalState) {
            console.log('🧹 Clearing previous modal state');
            window.modalState = {};
        }
        
        // Load the edit modal with cache busting
        const timestamp = Date.now();
        const url = `https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/rules?edit=${ruleId}&t=${timestamp}&nocache=${Math.random()}`;
        
        console.log('🔄 Loading fresh modal content from:', url);
        
        htmx.ajax('GET', url, {
            target: '#modal-content',
            swap: 'innerHTML'
        }).then(() => {
            console.log('✅ Edit modal loaded successfully');
        }).catch(error => {
            console.error('❌ Failed to load edit modal:', error);
            ClaimsApp.utils.showNotification('Failed to load edit form. Please try again.', 'error');
            this.closeModal();
        });
    },

    /**
     * Close the modal and clean up state
     */
    closeModal() {
        const modal = document.getElementById('rule-modal');
        const modalContent = document.getElementById('modal-content');
        
        if (modal) {
            modal.classList.remove('show');
            // Re-enable body scroll
            document.body.classList.remove('modal-open');
            document.body.style.overflow = 'auto';
            
            // Clear modal content to prevent caching issues
            if (modalContent) {
                console.log('🧹 Clearing modal content to prevent cache issues');
                modalContent.innerHTML = `
                    <div class="p-8 text-center">
                        <div class="text-gray-500">Modal closed</div>
                    </div>
                `;
            }
            
            // Clear any global modal state
            if (window.modalState) {
                console.log('🧹 Clearing modal state');
                window.modalState = {};
            }
        }
    },

    /**
     * Handle edit form response
     */
    handleEditResponse(event) {
        if (event.detail.successful) {
            this.closeModal();
            ClaimsApp.utils.showNotification('Rule updated successfully! 🎉', 'success');
            // Refresh the rules list
            htmx.ajax('GET', 'https://bef4xsajbb.execute-api.us-east-1.amazonaws.com/dev/rules', {
                target: '#rules-container'
            });
        } else {
            ClaimsApp.utils.showNotification('Failed to update rule. Try again!', 'error');
        }
    }
};

// Set up modal event listeners when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('rule-modal');
    if (modal) {
        // Close modal when clicking outside
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                ClaimsApp.modal.closeModal();
            }
        });
    }
});

// Make functions globally available for onclick handlers
window.closeModal = ClaimsApp.modal.closeModal.bind(ClaimsApp.modal);
window.handleEditResponse = ClaimsApp.modal.handleEditResponse.bind(ClaimsApp.modal);

console.log('🚀 Modal management loaded');