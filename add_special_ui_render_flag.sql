-- ============================================================
-- Add special_ui_render Flag to prism_system_config
-- ============================================================
-- Purpose: Flag parameters that should appear in "Basic Information"
--          section vs "Additional Parameters" section
--
-- Usage:
--   1. Run this script to add the column
--   2. Set special_ui_render = true for fields you want in Basic Info
--   3. Lambda code will dynamically separate fields based on this flag
-- ============================================================

-- Step 1: Add the column with default false
ALTER TABLE application.prism_system_config
ADD COLUMN IF NOT EXISTS special_ui_render BOOLEAN DEFAULT false;

-- Step 2: Add comment to document the column's purpose
COMMENT ON COLUMN application.prism_system_config.special_ui_render IS
'Flag to indicate if this parameter should be rendered in a special UI section (e.g., Basic Information vs Additional Parameters). When true, the field appears prominently in the main form section.';

-- ============================================================
-- Example: Set the flag for fields you want in Basic Info
-- ============================================================
-- Uncomment and modify these as needed:

-- UPDATE application.prism_system_config
-- SET special_ui_render = true
-- WHERE config_type = 'price_parameters'
--   AND parent_code IS NULL
--   AND config_code = 'formulary';

-- UPDATE application.prism_system_config
-- SET special_ui_render = true
-- WHERE config_type = 'price_parameters'
--   AND parent_code IS NULL
--   AND config_code = 'client_size';

-- UPDATE application.prism_system_config
-- SET special_ui_render = true
-- WHERE config_type = 'price_parameters'
--   AND parent_code IS NULL
--   AND config_code = 'contract_duration';

-- ============================================================
-- Verification Queries
-- ============================================================

-- View all parameters with their special_ui_render flag
-- SELECT
--     config_type,
--     config_code,
--     display_name,
--     special_ui_render,
--     parent_code,
--     display_order,
--     is_active
-- FROM application.prism_system_config
-- WHERE config_type = 'price_parameters'
--   AND parent_code IS NULL
-- ORDER BY special_ui_render DESC, display_order;

-- View parameters grouped by special_ui_render
-- SELECT
--     special_ui_render,
--     COUNT(*) as parameter_count,
--     STRING_AGG(config_code, ', ' ORDER BY display_order) as parameters
-- FROM application.prism_system_config
-- WHERE config_type = 'price_parameters'
--   AND parent_code IS NULL
--   AND is_active = true
-- GROUP BY special_ui_render;
