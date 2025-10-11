-- ============================================================
-- Add Parameter Interdependence Support
-- ============================================================
-- Purpose:
--   Support conditional parameters (show/hide based on other parameter having ANY value)
--
-- Note:
--   - field_type already exists in validation_rules JSONB column
--   - We only need depends_on to control visibility
--   - If depends_on has a value, the field shows when parent has ANY non-empty value
-- ============================================================

-- Add depends_on column (which parameter controls visibility)
ALTER TABLE application.prism_system_config
ADD COLUMN IF NOT EXISTS depends_on VARCHAR(100) DEFAULT NULL;

-- Add comment
COMMENT ON COLUMN application.prism_system_config.depends_on IS
'Code of the parameter this field depends on. When specified, this field only appears when the parent parameter has any non-empty value selected.';

-- ============================================================
-- Example: Configure custom_pricing_note parameter
-- ============================================================
-- Uncomment to set custom_pricing_note to depend on custom_pricing

-- UPDATE application.prism_system_config
-- SET depends_on = 'custom_pricing'
-- WHERE config_type = 'price_parameters'
--   AND config_code = 'custom_pricing_note'
--   AND parent_code IS NULL;

-- ============================================================
-- Verification Queries
-- ============================================================

-- View all parameters with their field types and dependencies
-- SELECT
--     config_code,
--     display_name,
--     validation_rules->>'field_type' as field_type,
--     depends_on,
--     special_ui_render,
--     is_active
-- FROM application.prism_system_config
-- WHERE config_type = 'price_parameters'
--   AND parent_code IS NULL
-- ORDER BY display_order;

-- View conditional parameters (ones that depend on other parameters)
-- SELECT
--     child.config_code as dependent_field,
--     child.display_name as dependent_field_name,
--     child.validation_rules->>'field_type' as field_type,
--     child.depends_on as parent_field,
--     parent.display_name as parent_field_name
-- FROM application.prism_system_config child
-- LEFT JOIN application.prism_system_config parent
--     ON parent.config_code = child.depends_on
--     AND parent.config_type = 'price_parameters'
-- WHERE child.config_type = 'price_parameters'
--   AND child.parent_code IS NULL
--   AND child.depends_on IS NOT NULL
-- ORDER BY child.display_order;
