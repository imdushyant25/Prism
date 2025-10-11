# Dynamic Pricing Structure Configuration

## Overview
The pricing structure is now **completely data-driven** from the `prism_system_config` table, making it flexible and maintainable without code changes.

## Database Structure

### 1. Pricing Categories (`pricing_category`)
Main pricing categories that organize the pricing structure.

```sql
SELECT * FROM application.prism_system_config
WHERE config_type = 'pricing_category'
ORDER BY display_order;
```

**Examples:**
- `overall_fee_credit` - Overall Fees & Credits
- `retail` - Retail
- `retail_90` - Retail 90
- `mail` - Mail
- `specialty_mail` - Specialty Mail
- `ldd_blended_specialty` - LDD Blended Specialty
- `non_ldd_blended_specialty` - Non-LDD Blended Specialty

### 2. Pricing Subcategories (`pricing_subcategory`)
Subcategories within each category (brand/generic split).

```sql
SELECT * FROM application.prism_system_config
WHERE config_type = 'pricing_subcategory'
ORDER BY parent_code, display_order;
```

**Examples:**
- `brand` (parent: retail, retail_90, mail, etc.)
- `generic` (parent: retail, retail_90, mail, etc.)

**Note:** `overall_fee_credit`, `ldd_blended_specialty`, and `non_ldd_blended_specialty` do NOT have subcategories.

### 3. Pricing Fields (`pricing_field`)
Actual input fields for each subcategory or category.

```sql
SELECT * FROM application.prism_system_config
WHERE config_type = 'pricing_field'
ORDER BY parent_code, display_order;
```

**For Brand Subcategory:**
- `rebate` - Rebate ($)
- `discount` - Discount (%)
- `dispensing_fee` - Dispensing Fee ($)

**For Generic Subcategory:**
- `discount` - Discount (%)
- `dispensing_fee` - Dispensing Fee ($)

**For Categories Without Subcategories:**
- `overall_fee_credit` → `pepm_rebate_credit`, `pricing_fee`, `inhouse_pharmacy_fee`
- `ldd_blended_specialty` → `rebate`, `discount`, `dispensing_fee`
- `non_ldd_blended_specialty` → `rebate`, `discount`, `dispensing_fee`

## How It Works

### 1. Lambda Function: `getPricingStructure(client)`
Location: `/src/Lambda/price-book-index.js` (lines 261-327)

Queries the database to build the complete pricing structure hierarchy:

```javascript
const pricingStructure = await getPricingStructure(client);
```

**Returns:**
```json
[
  {
    "category_code": "retail",
    "category_name": "Retail",
    "category_order": 2,
    "structure": [
      {
        "subcategory_code": "brand",
        "subcategory_name": "Brand",
        "fields": [
          {"field_code": "rebate", "field_name": "Rebate ($)"},
          {"field_code": "discount", "field_name": "Discount (%)"},
          {"field_code": "dispensing_fee", "field_name": "Dispensing Fee ($)"}
        ]
      },
      {
        "subcategory_code": "generic",
        "subcategory_name": "Generic",
        "fields": [
          {"field_code": "discount", "field_name": "Discount (%)"},
          {"field_code": "dispensing_fee", "field_name": "Dispensing Fee ($)"}
        ]
      }
    ]
  },
  {
    "category_code": "overall_fee_credit",
    "category_name": "Overall Fees & Credits",
    "category_order": 1,
    "structure": [
      {
        "subcategory_code": null,
        "subcategory_name": null,
        "fields": [
          {"field_code": "pepm_rebate_credit", "field_name": "PEPM Rebate Credit ($)"},
          {"field_code": "pricing_fee", "field_name": "Pricing Fee ($)"},
          {"field_code": "inhouse_pharmacy_fee", "field_name": "In-House Pharmacy Fee ($)"}
        ]
      }
    ]
  }
]
```

### 2. Form Generation
The pricing structure data is used to dynamically generate HTML forms with proper field names.

**Field Naming Convention:**
- **With Subcategory:** `{category}_{subcategory}_{field}`
  - Example: `retail_brand_rebate`, `mail_generic_discount`

- **Without Subcategory:** `{category}_{field}`
  - Example: `overall_fee_credit_pepm_rebate_credit`, `ldd_blended_specialty_rebate`

### 3. Data Storage
Form data is flattened and stored in database as nested JSON:

**Submitted Form Data:**
```
retail_brand_rebate = 3.50
retail_brand_discount = 15.5
retail_generic_discount = 80.0
```

**Stored in Database (`pricing_structure` JSONB column):**
```json
{
  "retail": {
    "brand": {
      "rebate": 3.50,
      "discount": 15.5,
      "dispensing_fee": 1.75
    },
    "generic": {
      "discount": 80.0,
      "dispensing_fee": 0.50
    }
  }
}
```

## Benefits

### 1. **Flexibility**
- Add new categories: Just insert into `pricing_category`
- Add new fields: Just insert into `pricing_field`
- NO CODE CHANGES REQUIRED

### 2. **Consistency**
- Field labels come from database
- Display order controlled by `display_order` column
- Validation rules can be stored in `validation_rules` column

### 3. **Maintainability**
- Single source of truth (database)
- Easy to update field names or add descriptions
- Can enable/disable fields with `is_active` flag

### 4. **Scalability**
- Support for PBM-specific fields (using `pbm_code` column)
- Can add field-level permissions
- Easy to extend with new field types

## Setup Instructions

### Step 1: Run SQL Script
Execute the pricing field setup script:

```bash
psql your_connection_string -f pricing_field_setup.sql
```

This inserts all pricing field definitions.

### Step 2: Verify Data
```sql
-- Check categories
SELECT * FROM application.prism_system_config
WHERE config_type = 'pricing_category'
ORDER BY display_order;

-- Check subcategories
SELECT * FROM application.prism_system_config
WHERE config_type = 'pricing_subcategory'
ORDER BY parent_code, display_order;

-- Check fields
SELECT * FROM application.prism_system_config
WHERE config_type = 'pricing_field'
ORDER BY parent_code, display_order;

-- Check complete hierarchy
SELECT
    cat.config_code as category,
    cat.display_name as category_name,
    sub.config_code as subcategory,
    sub.display_name as subcategory_name,
    field.config_code as field,
    field.display_name as field_name
FROM application.prism_system_config cat
LEFT JOIN application.prism_system_config sub
    ON sub.parent_code = cat.config_code
    AND sub.config_type = 'pricing_subcategory'
LEFT JOIN application.prism_system_config field
    ON field.parent_code = COALESCE(sub.config_code, cat.config_code)
    AND field.config_type = 'pricing_field'
WHERE cat.config_type = 'pricing_category'
  AND cat.is_active = true
ORDER BY cat.display_order, sub.display_order, field.display_order;
```

### Step 3: Test Lambda Function
The `getPricingStructure()` function will automatically use the new structure.

## Future Enhancements

### 1. Field Types
Add a `field_type` column to support different input types:
- `number` - Numeric input
- `percentage` - Percentage input (0-100)
- `currency` - Currency input with $ symbol
- `select` - Dropdown selection

### 2. Validation Rules
Store validation rules in `validation_rules` JSONB column:
```json
{
  "min": 0,
  "max": 100,
  "required": true,
  "step": 0.01
}
```

### 3. Conditional Fields
Add fields that only appear based on other field values:
```json
{
  "show_if": {
    "field": "has_rebate",
    "value": "yes"
  }
}
```

### 4. PBM-Specific Fields
Use `pbm_code` column to show/hide fields based on selected PBM.

## Migration Notes

### Old Approach (Hardcoded)
```javascript
// Hardcoded in Lambda function
RETAIL_BRAND_REBATE: getNestedValue(pricingStructure, 'retail.brand.rebate'),
RETAIL_BRAND_DISCOUNT: getNestedValue(pricingStructure, 'retail.brand.discount'),
// ... 50+ more hardcoded fields
```

### New Approach (Data-Driven)
```javascript
// Dynamic from database
const pricingStructure = await getPricingStructure(client);
// Generate form fields dynamically
const formHTML = generatePricingFormHTML(pricingStructure, currentValues);
```

## Testing

### Test Cases
1. **Add New Category**: Add a new category in system_config and verify it appears in the form
2. **Add New Field**: Add a new field to a category and verify it appears in the correct position
3. **Disable Field**: Set `is_active = false` and verify field is hidden
4. **Change Order**: Update `display_order` and verify fields rearrange
5. **Update Labels**: Change `display_name` and verify new label appears

## Support

For questions or issues:
1. Check the SQL script for proper data structure
2. Review Lambda function logs for query errors
3. Verify `prism_system_config` table has correct relationships
