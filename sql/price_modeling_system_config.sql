-- System configuration entries for Price Modeling
-- These drive the UI dropdowns and business-friendly labels

-- PBM Configurations
INSERT INTO application.prism_system_config (
    config_type, config_code, display_name, display_order, description, is_active, is_default
) VALUES 
('pbm', 'CVS', 'CVS Health', 1, 'CVS Health Pharmacy Benefit Manager', true, true),
('pbm', 'ESI', 'Express Scripts', 2, 'Express Scripts Pharmacy Benefit Manager', true, false),
('pbm', 'OPT', 'OptumRx', 3, 'OptumRx Pharmacy Benefit Manager', true, false),
('pbm', 'HUM', 'Humana Pharmacy', 4, 'Humana Pharmacy Solutions', true, false),
('pbm', 'CAR', 'Caremark', 5, 'CVS Caremark', true, false);

-- Client Size Configurations
INSERT INTO application.prism_system_config (
    config_type, config_code, display_name, display_order, description, is_active, is_default
) VALUES 
('client_size', 'Enterprise', 'Enterprise (10,000+)', 1, 'Large enterprise clients with 10,000+ members', true, false),
('client_size', 'Large', 'Large (5,000-10,000)', 2, 'Large clients with 5,000 to 10,000 members', true, true),
('client_size', 'Medium', 'Medium (1,000-5,000)', 3, 'Medium clients with 1,000 to 5,000 members', true, false),
('client_size', 'Small', 'Small (<1,000)', 4, 'Small clients with less than 1,000 members', true, false);

-- Contract Type Configurations
INSERT INTO application.prism_system_config (
    config_type, config_code, display_name, display_order, description, is_active, is_default
) VALUES 
('contract_type', 'Standard', 'Standard', 1, 'Standard contract with basic terms', true, true),
('contract_type', 'Standard Plus', 'Standard Plus', 2, 'Enhanced standard contract with additional benefits', true, false),
('contract_type', 'Custom', 'Custom', 3, 'Fully customized contract terms', true, false),
('contract_type', 'Rebate Plus', 'Rebate Plus', 4, 'Contract focused on maximizing rebates', true, false),
('contract_type', 'Performance Based', 'Performance Based', 5, 'Contract with performance-based incentives', true, false);

-- Pricing Type Configurations
INSERT INTO application.prism_system_config (
    config_type, config_code, display_name, display_order, description, is_active, is_default
) VALUES 
('pricing_type', 'Fee for Service', 'Fee for Service', 1, 'Traditional fee-for-service pricing model', true, true),
('pricing_type', 'Capitated', 'Capitated', 2, 'Per-member-per-month capitated pricing', true, false),
('pricing_type', 'Hybrid', 'Hybrid', 3, 'Combination of fee-for-service and capitated', true, false),
('pricing_type', 'Value Based', 'Value Based', 4, 'Pricing based on health outcomes and value', true, false);

-- Pricing Category Configurations (for UI display and JSON structure mapping)
INSERT INTO application.prism_system_config (
    config_type, config_code, display_name, display_order, description, parent_code, config_level, is_active
) VALUES 
-- Top Level Categories
('pricing_category', 'overall_fee_credit', 'Overall Fees & Credits', 1, 'Overall fees and credits applied to the plan', null, 1, true),
('pricing_category', 'retail', 'Retail Pharmacy', 2, 'Traditional retail pharmacy pricing', null, 1, true),
('pricing_category', 'retail_90', 'Retail 90-Day', 3, 'Extended-day supply at retail pharmacies', null, 1, true),
('pricing_category', 'maintenance', 'Maintenance Choice', 4, 'Maintenance medication programs', null, 1, true),
('pricing_category', 'mail', 'Mail Order', 5, 'Mail order pharmacy pricing', null, 1, true),
('pricing_category', 'specialty_mail', 'Specialty Mail', 6, 'Specialty medications via mail', null, 1, true),
('pricing_category', 'specialty_retail', 'Specialty Retail', 7, 'Specialty medications at retail', null, 1, true),
('pricing_category', 'limited_distribution_mail', 'Limited Distribution Mail', 8, 'Limited distribution drugs via mail', null, 1, true),
('pricing_category', 'limited_distribution_retail', 'Limited Distribution Retail', 9, 'Limited distribution drugs at retail', null, 1, true),
('pricing_category', 'ldd_blended_specialty', 'LDD Blended Specialty', 10, 'Limited distribution drug blended specialty pricing', null, 1, true),
('pricing_category', 'non_ldd_blended_specialty', 'Non-LDD Blended Specialty', 11, 'Non-limited distribution blended specialty pricing', null, 1, true);

-- Sub-Categories for Brand/Generic
INSERT INTO application.prism_system_config (
    config_type, config_code, display_name, display_order, description, parent_code, config_level, is_active
) VALUES 
-- Brand sub-categories
('pricing_subcategory', 'brand', 'Brand', 1, 'Brand name medications', 'retail', 2, true),
('pricing_subcategory', 'generic', 'Generic', 2, 'Generic medications', 'retail', 2, true),
('pricing_subcategory', 'brand', 'Brand', 1, 'Brand name medications', 'retail_90', 2, true),
('pricing_subcategory', 'generic', 'Generic', 2, 'Generic medications', 'retail_90', 2, true),
('pricing_subcategory', 'brand', 'Brand', 1, 'Brand name medications', 'maintenance', 2, true),
('pricing_subcategory', 'generic', 'Generic', 2, 'Generic medications', 'maintenance', 2, true),
('pricing_subcategory', 'brand', 'Brand', 1, 'Brand name medications', 'mail', 2, true),
('pricing_subcategory', 'generic', 'Generic', 2, 'Generic medications', 'mail', 2, true),
('pricing_subcategory', 'brand', 'Brand', 1, 'Brand name medications', 'specialty_mail', 2, true),
('pricing_subcategory', 'generic', 'Generic', 2, 'Generic medications', 'specialty_mail', 2, true),
('pricing_subcategory', 'brand', 'Brand', 1, 'Brand name medications', 'specialty_retail', 2, true),
('pricing_subcategory', 'generic', 'Generic', 2, 'Generic medications', 'specialty_retail', 2, true),
('pricing_subcategory', 'brand', 'Brand', 1, 'Brand name medications', 'limited_distribution_mail', 2, true),
('pricing_subcategory', 'generic', 'Generic', 2, 'Generic medications', 'limited_distribution_mail', 2, true),
('pricing_subcategory', 'brand', 'Brand', 1, 'Brand name medications', 'limited_distribution_retail', 2, true),
('pricing_subcategory', 'generic', 'Generic', 2, 'Generic medications', 'limited_distribution_retail', 2, true);

-- Pricing Field Types (for individual pricing elements)
INSERT INTO application.prism_system_config (
    config_type, config_code, display_name, display_order, description, validation_rules, is_active
) VALUES 
('pricing_field', 'rebate', 'Rebate', 1, 'Rebate amount or percentage', '{"type": "number", "min": 0, "max": 10000, "step": 0.01}', true),
('pricing_field', 'discount', 'Discount %', 2, 'Discount percentage', '{"type": "percentage", "min": 0, "max": 100, "step": 0.01}', true),
('pricing_field', 'dispensing_fee', 'Dispensing Fee', 3, 'Per-prescription dispensing fee', '{"type": "currency", "min": 0, "max": 50, "step": 0.01}', true),
('pricing_field', 'pepm_rebate_credit', 'PEPM Rebate Credit', 4, 'Per-member-per-month rebate credit', '{"type": "currency", "min": 0, "max": 50, "step": 0.01}', true),
('pricing_field', 'pricing_fee', 'Pricing Fee', 5, 'Administrative pricing fee', '{"type": "currency", "min": 0, "max": 10, "step": 0.01}', true),
('pricing_field', 'inhouse_pharmacy_fee', 'In-House Pharmacy Fee', 6, 'Fee for in-house pharmacy services', '{"type": "currency", "min": 0, "max": 10, "step": 0.01}', true);

-- Status configurations for filtering
INSERT INTO application.prism_system_config (
    config_type, config_code, display_name, display_order, description, is_active, is_default
) VALUES 
('model_status', 'active', 'Active', 1, 'Currently active pricing models', true, true),
('model_status', 'inactive', 'Inactive', 2, 'Inactive pricing models', true, false),
('model_status', 'draft', 'Draft', 3, 'Draft pricing models', true, false),
('model_status', 'baseline', 'Baseline', 4, 'Baseline pricing models for comparison', true, false);

-- Update all created_at and updated_at timestamps
UPDATE application.prism_system_config 
SET created_at = NOW(), updated_at = NOW(), created_by = 'system_admin'
WHERE created_by IS NULL;