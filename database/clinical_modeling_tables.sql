-- Clinical Modeling Backend Tables

-- Table to store clinical models metadata (source-agnostic)
CREATE TABLE application.prism_clinical_models (
    model_id bigserial NOT NULL,
    model_name varchar(240) NOT NULL,
    description text NULL,
    created_by varchar(100) NULL,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP NULL,
    is_active boolean DEFAULT false,
    CONSTRAINT prism_clinical_models_pkey PRIMARY KEY (model_id),
    CONSTRAINT prism_clinical_models_model_name_unique UNIQUE (model_name)
);

-- Table to store multiple criteria per model with source context
CREATE TABLE application.prism_model_criteria (
    criteria_id bigserial NOT NULL,
    model_id bigint NOT NULL,
    source_type varchar(50) NOT NULL DEFAULT 'formulary',
    pbm varchar(50) NOT NULL,
    formulary_name varchar(240) NOT NULL,
    field_name varchar(50) NOT NULL,
    operator varchar(20) NOT NULL,
    criteria_value text NOT NULL,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT prism_model_criteria_pkey PRIMARY KEY (criteria_id),
    CONSTRAINT prism_model_criteria_model_fk FOREIGN KEY (model_id) REFERENCES application.prism_clinical_models(model_id) ON DELETE CASCADE
);

-- Table to store the actual NDCs that match the model criteria
CREATE TABLE application.prism_model_lists (
    id bigserial NOT NULL,
    model_id bigint NOT NULL,
    ndc11 varchar(11) NOT NULL,
    gpi14 varchar(14) NULL,
    pbm varchar(50) NOT NULL,
    list_type varchar(240) NOT NULL,
    action varchar(1) NOT NULL,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT prism_model_lists_pkey PRIMARY KEY (id),
    CONSTRAINT prism_model_lists_model_fk FOREIGN KEY (model_id) REFERENCES application.prism_clinical_models(model_id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX idx_prism_clinical_models_is_active ON application.prism_clinical_models (is_active);
CREATE INDEX idx_prism_clinical_models_created_by ON application.prism_clinical_models (created_by);
CREATE INDEX idx_prism_model_criteria_model_id ON application.prism_model_criteria (model_id);
CREATE INDEX idx_prism_model_lists_model_id ON application.prism_model_lists (model_id);
CREATE INDEX idx_prism_model_lists_ndc11 ON application.prism_model_lists (ndc11);
CREATE INDEX idx_prism_model_lists_gpi14 ON application.prism_model_lists (gpi14);