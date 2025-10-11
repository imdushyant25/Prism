# Field Type Implementation Status

## ✅ Completed

1. **Database Migration** - Added `depends_on` column
2. **Lambda Query Update** - Query now includes `depends_on` column from database

## 🚧 Remaining Work

### Lambda Code Changes Needed

The Lambda code currently assumes ALL parameters are dropdowns. Need to update rendering to check `validation_rules.field_type` from database.

**Files to update**: `/Users/dushyantsingh/Documents/Prism/src/Lambda/price-book-index.js`

**Line 416-435**: Basic Info Fields rendering (Edit Modal)
- Currently: Hardcoded `<select>` dropdown
- Need: Check `param.validation_rules.field_type` and render appropriate field

**Line 440-460**: Additional Parameters rendering (Edit Modal)
- Currently: Hardcoded `<select>` dropdown
- Need: Check `param.validation_rules.field_type` and render appropriate field

**Helper Function Needed** (add around line 265):
```javascript
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
```

**Then update lines 416-435** to:
```javascript
// Generate Basic Info parameter fields (special_ui_render = true)
let basicInfoFieldsHTML = '';
basicInfoParams.forEach(param => {
    const currentValue = config[param.parameter_code] || additionalParameters[param.parameter_code] || '';
    const cssClasses = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500';
    basicInfoFieldsHTML += renderParameterField(param, param.parameter_code, currentValue, cssClasses);
});
```

**And update lines 440-460** to:
```javascript
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
```

### JavaScript Code Changes Needed

**File**: `/Users/dushyantsingh/Documents/Prism/src/js/app.js`

**Line 3159-3213**: Update `renderBasicInfoParameters()` function
- Currently: Hardcoded dropdown rendering
- Need: Check `param.validation_rules.field_type` and render appropriate field

**Line 3248-3315**: Update `renderAdditionalParameters()` function
- Currently: Hardcoded dropdown rendering for regular params
- Need: Check `param.validation_rules.field_type` and render appropriate field

**Add Conditional Visibility Logic** (after line 3315):
```javascript
/**
 * Setup conditional field visibility based on depends_on
 */
setupConditionalFields() {
    // Find all fields with data-depends-on attribute
    const conditionalFields = document.querySelectorAll('[data-depends-on]');

    conditionalFields.forEach(field => {
        const parentFieldName = field.getAttribute('data-depends-on');
        const parentField = document.querySelector(`[name="${parentFieldName}"], [name="param_${parentFieldName}"]`);

        if (!parentField) return;

        // Initially hide the conditional field
        field.style.display = 'none';

        // Function to update visibility
        const updateVisibility = () => {
            const parentValue = parentField.value;

            if (parentValue && parentValue.trim() !== '') {
                // Parent has a value, show the field
                field.style.display = '';
            } else {
                // Parent is empty, hide the field and clear its value
                field.style.display = 'none';
                const inputField = field.querySelector('input, textarea, select');
                if (inputField) {
                    inputField.value = '';
                }
            }
        };

        // Set initial visibility
        updateVisibility();

        // Listen for changes to parent field
        parentField.addEventListener('change', updateVisibility);
    });
}
```

**Call this function** after loading parameters (line 3148):
```javascript
this.renderAdditionalParameters(parameters);
this.setupConditionalFields(); // Add this line
```

## Testing Checklist

Once all changes are made:

1. ✅ Run SQL migration to add `depends_on` column
2. ✅ Configure `custom_pricing_note` with:
   - `validation_rules = '{"required": false, "field_type": "textarea", "max_length": 500}'`
   - `depends_on = 'custom_pricing'`
3. ⬜ Deploy Lambda with updated rendering logic
4. ⬜ Test dropdown parameters (existing behavior)
5. ⬜ Test textarea parameter (`custom_pricing_note`)
6. ⬜ Test conditional visibility:
   - `custom_pricing` empty → `custom_pricing_note` hidden
   - Select value in `custom_pricing` → `custom_pricing_note` appears
   - Clear `custom_pricing` → `custom_pricing_note` disappears + value cleared
7. ⬜ Test form submission with text field values
8. ⬜ Test edit modal loads text field values correctly

## Summary

**Database**: ✅ Ready
**Lambda Query**: ✅ Ready
**Lambda Rendering**: ✅ Complete - Helper function added + 2 rendering locations updated
**JavaScript Rendering**: ✅ Complete - Both functions updated + conditional logic added
**Testing**: ⬜ Ready for testing - All code changes deployed
