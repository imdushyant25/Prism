-- Pricing Field Configuration Setup
-- This script sets up the pricing_field records in prism_system_config

-- ============================================================
-- IMPORTANT: Run this query first to check for existing records
-- ============================================================
-- SELECT * FROM application.prism_system_config
-- WHERE config_type = 'pricing_field';
--
-- If records exist, you may want to DELETE them first:
-- DELETE FROM application.prism_system_config WHERE config_type = 'pricing_field';

-- ============================================================
-- PART 1: Fields for subcategories (brand and generic)
-- ============================================================

-- Note: The parent_code references the subcategory code 'brand' or 'generic'
-- These subcategories exist under multiple categories (retail, retail_90, mail, etc.)

-- Fields for BRAND subcategory (applies to all brand subcategories across all categories)
-- rebate, discount, dispensing_fee

INSERT INTO application.prism_system_config (config_type, config_code, display_name, display_order, parent_code, is_active, description)
VALUES
    ('pricing_field', 'rebate', 'Rebate ($)', 1, 'brand', true, 'Rebate amount in dollars'),
    ('pricing_field', 'discount', 'Discount (%)', 2, 'brand', true, 'Discount percentage'),
    ('pricing_field', 'dispensing_fee', 'Dispensing Fee ($)', 3, 'brand', true, 'Dispensing fee in dollars');

-- Fields for GENERIC subcategory (applies to all generic subcategories across all categories)
-- discount, dispensing_fee (NO rebate for generic)

INSERT INTO application.prism_system_config (config_type, config_code, display_name, display_order, parent_code, is_active, description)
VALUES
    ('pricing_field', 'discount', 'Discount (%)', 1, 'generic', true, 'Discount percentage'),
    ('pricing_field', 'dispensing_fee', 'Dispensing Fee ($)', 2, 'generic', true, 'Dispensing fee in dollars');


-- ============================================================
-- PART 2: Fields for overall_fee_credit (no subcategory)
-- ============================================================

INSERT INTO application.prism_system_config (config_type, config_code, display_name, display_order, parent_code, is_active, description)
VALUES
    ('pricing_field', 'pepm_rebate_credit', 'PEPM Rebate Credit ($)', 1, 'overall_fee_credit', true, 'Per Employee Per Month rebate credit'),
    ('pricing_field', 'pricing_fee', 'Pricing Fee ($)', 2, 'overall_fee_credit', true, 'Pricing fee amount'),
    ('pricing_field', 'inhouse_pharmacy_fee', 'In-House Pharmacy Fee ($)', 3, 'overall_fee_credit', true, 'In-house pharmacy fee');


-- ============================================================
-- PART 3: Fields for ldd_blended_specialty (no subcategory)
-- ============================================================

INSERT INTO application.prism_system_config (config_type, config_code, display_name, display_order, parent_code, is_active, description)
VALUES
    ('pricing_field', 'rebate', 'Rebate ($)', 1, 'ldd_blended_specialty', true, 'Rebate amount in dollars'),
    ('pricing_field', 'discount', 'Discount (%)', 2, 'ldd_blended_specialty', true, 'Discount percentage'),
    ('pricing_field', 'dispensing_fee', 'Dispensing Fee ($)', 3, 'ldd_blended_specialty', true, 'Dispensing fee in dollars');


-- ============================================================
-- PART 4: Fields for non_ldd_blended_specialty (no subcategory)
-- ============================================================

INSERT INTO application.prism_system_config (config_type, config_code, display_name, display_order, parent_code, is_active, description)
VALUES
    ('pricing_field', 'rebate', 'Rebate ($)', 1, 'non_ldd_blended_specialty', true, 'Rebate amount in dollars'),
    ('pricing_field', 'discount', 'Discount (%)', 2, 'non_ldd_blended_specialty', true, 'Discount percentage'),
    ('pricing_field', 'dispensing_fee', 'Dispensing Fee ($)', 3, 'non_ldd_blended_specialty', true, 'Dispensing fee in dollars');


-- ============================================================
-- Verification Queries
-- ============================================================

-- View all pricing categories
-- SELECT * FROM application.prism_system_config WHERE config_type = 'pricing_category' ORDER BY display_order;

-- View all pricing subcategories
-- SELECT * FROM application.prism_system_config WHERE config_type = 'pricing_subcategory' ORDER BY parent_code, display_order;

-- View all pricing fields
-- SELECT * FROM application.prism_system_config WHERE config_type = 'pricing_field' ORDER BY parent_code, display_order;

-- View complete hierarchy for a specific category (e.g., retail)
-- SELECT
--     cat.config_code as category,
--     cat.display_name as category_name,
--     sub.config_code as subcategory,
--     sub.display_name as subcategory_name,
--     field.config_code as field,
--     field.display_name as field_name
-- FROM application.prism_system_config cat
-- LEFT JOIN application.prism_system_config sub ON sub.parent_code = cat.config_code AND sub.config_type = 'pricing_subcategory'
-- LEFT JOIN application.prism_system_config field ON field.parent_code = sub.config_code AND field.config_type = 'pricing_field'
-- WHERE cat.config_type = 'pricing_category' AND cat.config_code = 'retail'
-- ORDER BY sub.display_order, field.display_order;
