-- Sample data for prism_price_modeling table
-- This includes realistic pricing structures with some null values as mentioned

-- CVS Models
INSERT INTO application.prism_price_modeling (
    name, pbm_code, client_size, contract_type, pricing_type, pricing_structure, 
    description, created_by, is_baseline
) VALUES 
(
    'CVS Standard Large Client Model',
    'CVS',
    'Large',
    'Standard',
    'Fee for Service',
    '{
        "overall_fee_credit": {
            "pepm_rebate_credit": 2.5,
            "pricing_fee": 0.85,
            "inhouse_pharmacy_fee": 1.25
        },
        "retail": {
            "brand": {
                "rebate": 350,
                "discount": 19.85,
                "dispensing_fee": 2.45
            },
            "generic": {
                "discount": 87.15,
                "dispensing_fee": 2.45
            }
        },
        "retail_90": {
            "brand": {
                "rebate": 900,
                "discount": 22.50,
                "dispensing_fee": 7.50
            },
            "generic": {
                "discount": 88.60,
                "dispensing_fee": 7.50
            }
        },
        "mail": {
            "brand": {
                "rebate": 910,
                "discount": 21,
                "dispensing_fee": 0
            },
            "generic": {
                "discount": 91,
                "dispensing_fee": 0
            }
        },
        "specialty_mail": {
            "brand": {
                "rebate": null,
                "discount": 15.5,
                "dispensing_fee": 15.00
            },
            "generic": {
                "discount": 85,
                "dispensing_fee": 15.00
            }
        },
        "specialty_retail": {
            "brand": {
                "rebate": null,
                "discount": 12.5,
                "dispensing_fee": 2.45
            },
            "generic": {
                "discount": 80,
                "dispensing_fee": 2.45
            }
        },
        "ldd_blended_specialty": {
            "rebate": 3550,
            "discount": 16.1,
            "dispensing_fee": null
        },
        "non_ldd_blended_specialty": {
            "rebate": 3550,
            "discount": 23,
            "dispensing_fee": null
        }
    }',
    'Standard pricing model for large CVS clients with comprehensive coverage',
    'system_admin',
    true
),
(
    'CVS Enterprise Premium Model',
    'CVS',
    'Enterprise',
    'Standard Plus',
    'Fee for Service',
    '{
        "overall_fee_credit": {
            "pepm_rebate_credit": 3.75,
            "pricing_fee": 0.65,
            "inhouse_pharmacy_fee": 1.50
        },
        "retail": {
            "brand": {
                "rebate": 450,
                "discount": 22.85,
                "dispensing_fee": 2.25
            },
            "generic": {
                "discount": 89.15,
                "dispensing_fee": 2.25
            }
        },
        "retail_90": {
            "brand": {
                "rebate": 1100,
                "discount": 25.50,
                "dispensing_fee": 7.00
            },
            "generic": {
                "discount": 90.60,
                "dispensing_fee": 7.00
            }
        },
        "maintenance": {
            "brand": {
                "rebate": null,
                "discount": 24.0,
                "dispensing_fee": null
            },
            "generic": {
                "discount": 88.0,
                "dispensing_fee": null
            }
        },
        "mail": {
            "brand": {
                "rebate": 1200,
                "discount": 24,
                "dispensing_fee": 0
            },
            "generic": {
                "discount": 93,
                "dispensing_fee": 0
            }
        },
        "specialty_mail": {
            "brand": {
                "rebate": 4200,
                "discount": 18.5,
                "dispensing_fee": 12.00
            },
            "generic": {
                "discount": 87,
                "dispensing_fee": 12.00
            }
        },
        "ldd_blended_specialty": {
            "rebate": 4200,
            "discount": 18.5,
            "dispensing_fee": null
        },
        "non_ldd_blended_specialty": {
            "rebate": 4200,
            "discount": 26.5,
            "dispensing_fee": null
        }
    }',
    'Premium pricing model for enterprise CVS clients with enhanced specialty benefits',
    'system_admin',
    false
),

-- Express Scripts Models
(
    'ESI Standard Medium Client Model',
    'ESI',
    'Medium',
    'Standard',
    'Fee for Service',
    '{
        "overall_fee_credit": {
            "pepm_rebate_credit": 2.25,
            "pricing_fee": 0.95,
            "inhouse_pharmacy_fee": 1.10
        },
        "retail": {
            "brand": {
                "rebate": 320,
                "discount": 18.25,
                "dispensing_fee": 2.65
            },
            "generic": {
                "discount": 85.15,
                "dispensing_fee": 2.65
            }
        },
        "retail_90": {
            "brand": {
                "rebate": 820,
                "discount": 21.00,
                "dispensing_fee": 8.00
            },
            "generic": {
                "discount": 87.00,
                "dispensing_fee": 8.00
            }
        },
        "mail": {
            "brand": {
                "rebate": 850,
                "discount": 19.5,
                "dispensing_fee": 0
            },
            "generic": {
                "discount": 89.5,
                "dispensing_fee": 0
            }
        },
        "specialty_mail": {
            "brand": {
                "rebate": null,
                "discount": 14.0,
                "dispensing_fee": 18.00
            },
            "generic": {
                "discount": 82,
                "dispensing_fee": 18.00
            }
        },
        "limited_distribution_mail": {
            "brand": {
                "rebate": null,
                "discount": null,
                "dispensing_fee": null
            },
            "generic": {
                "discount": null,
                "dispensing_fee": null
            }
        },
        "ldd_blended_specialty": {
            "rebate": 3200,
            "discount": 15.5,
            "dispensing_fee": null
        }
    }',
    'Standard ESI model for medium-sized clients',
    'system_admin',
    false
),

-- OptumRx Models
(
    'OptumRx Specialty Focus Model',
    'OPT',
    'Large',
    'Rebate Plus',
    'Hybrid',
    '{
        "overall_fee_credit": {
            "pepm_rebate_credit": 4.25,
            "pricing_fee": 0.55,
            "inhouse_pharmacy_fee": 1.75
        },
        "retail": {
            "brand": {
                "rebate": 380,
                "discount": 20.50,
                "dispensing_fee": 2.35
            },
            "generic": {
                "discount": 86.50,
                "dispensing_fee": 2.35
            }
        },
        "mail": {
            "brand": {
                "rebate": 950,
                "discount": 22.5,
                "dispensing_fee": 0
            },
            "generic": {
                "discount": 92,
                "dispensing_fee": 0
            }
        },
        "specialty_mail": {
            "brand": {
                "rebate": 5500,
                "discount": 22.0,
                "dispensing_fee": 10.00
            },
            "generic": {
                "discount": 90,
                "dispensing_fee": 10.00
            }
        },
        "specialty_retail": {
            "brand": {
                "rebate": 4800,
                "discount": 18.5,
                "dispensing_fee": 2.35
            },
            "generic": {
                "discount": 85,
                "dispensing_fee": 2.35
            }
        },
        "ldd_blended_specialty": {
            "rebate": 5800,
            "discount": 20.5,
            "dispensing_fee": null
        },
        "non_ldd_blended_specialty": {
            "rebate": 5800,
            "discount": 28.0,
            "dispensing_fee": null
        }
    }',
    'Specialty-focused model for OptumRx large clients with enhanced rebates',
    'system_admin',
    false
),

-- Humana Model
(
    'Humana Enterprise Custom Model',
    'HUM',
    'Enterprise',
    'Custom',
    'Capitated',
    '{
        "overall_fee_credit": {
            "pepm_rebate_credit": 5.50,
            "pricing_fee": 0.45,
            "inhouse_pharmacy_fee": 2.25
        },
        "retail": {
            "brand": {
                "rebate": 520,
                "discount": 25.00,
                "dispensing_fee": 2.00
            },
            "generic": {
                "discount": 92.00,
                "dispensing_fee": 2.00
            }
        },
        "retail_90": {
            "brand": {
                "rebate": 1350,
                "discount": 28.00,
                "dispensing_fee": 6.50
            },
            "generic": {
                "discount": 93.50,
                "dispensing_fee": 6.50
            }
        },
        "maintenance": {
            "brand": {
                "rebate": 1200,
                "discount": 26.5,
                "dispensing_fee": 5.00
            },
            "generic": {
                "discount": 91.5,
                "dispensing_fee": 5.00
            }
        },
        "mail": {
            "brand": {
                "rebate": 1400,
                "discount": 27,
                "dispensing_fee": 0
            },
            "generic": {
                "discount": 94.5,
                "dispensing_fee": 0
            }
        },
        "specialty_mail": {
            "brand": {
                "rebate": 6200,
                "discount": 25.0,
                "dispensing_fee": 8.00
            },
            "generic": {
                "discount": 92,
                "dispensing_fee": 8.00
            }
        },
        "specialty_retail": {
            "brand": {
                "rebate": 5500,
                "discount": 22.0,
                "dispensing_fee": 2.00
            },
            "generic": {
                "discount": 88,
                "dispensing_fee": 2.00
            }
        }
    }',
    'Custom capitated model for Humana enterprise clients',
    'system_admin',
    false
);

-- Update timestamps
UPDATE application.prism_price_modeling 
SET updated_at = created_at 
WHERE created_by = 'system_admin';