-- ============================================================
-- 011_workload_aware_assignment.sql
-- Workload-Aware Task Assignment (see docs/implementation/workload-aware-assignment.md)
-- ============================================================

-- 1. Employee skills (canonical, with verification state)
CREATE TABLE IF NOT EXISTS employee_skills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
    skill_name VARCHAR(150) NOT NULL,
    proficiency VARCHAR(20) NOT NULL DEFAULT 'intermediate'
        CHECK (proficiency IN ('beginner', 'intermediate', 'expert')),
    -- 'unverified' = extracted from CV but not reviewed;
    -- 'verified'   = manager/admin confirmed;
    -- 'rejected'   = explicitly dismissed
    verification_state VARCHAR(20) NOT NULL DEFAULT 'unverified'
        CHECK (verification_state IN ('unverified', 'verified', 'rejected')),
    source VARCHAR(50) NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual', 'cv_extraction', 'manager_review')),
    verified_by UUID,           -- user_id of reviewer
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (employee_id, skill_name)
);

CREATE INDEX IF NOT EXISTS idx_employee_skills_employee ON employee_skills (employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_skills_org ON employee_skills (organisation_id);

-- 2. Rolling performance metrics (refreshed async after task completions)
CREATE TABLE IF NOT EXISTS employee_performance_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
    -- Task history
    total_tasks_completed INT NOT NULL DEFAULT 0,
    tasks_on_time INT NOT NULL DEFAULT 0,
    -- Derived scores 0.0 – 1.0
    on_time_rate NUMERIC(5,4) NOT NULL DEFAULT 0.0,      -- reliability signal (25%)
    similar_work_score NUMERIC(5,4) NOT NULL DEFAULT 0.0, -- similar-work signal (45%)
    workload_score NUMERIC(5,4) NOT NULL DEFAULT 1.0,     -- available-capacity signal (15%, 1=free)
    verified_skills_score NUMERIC(5,4) NOT NULL DEFAULT 0.0, -- verified-skills signal (15%)
    composite_score NUMERIC(5,4) NOT NULL DEFAULT 0.0,   -- weighted sum of the four signals
    -- Capacity
    active_task_count INT NOT NULL DEFAULT 0,
    is_top_performer BOOLEAN NOT NULL DEFAULT FALSE,      -- composite_score > 0.75
    refreshed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (employee_id)
);

CREATE INDEX IF NOT EXISTS idx_emp_perf_org ON employee_performance_metrics (organisation_id);

-- 3. Task skill/tag fields (add columns to existing tasks table)
ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS required_skills TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS skill_tags TEXT[] DEFAULT '{}';

-- 4. Assignment recommendations
CREATE TABLE IF NOT EXISTS assignment_recommendations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    -- Primary recommendation
    recommended_employee_id UUID REFERENCES employee_profiles(id) ON DELETE SET NULL,
    score_breakdown JSONB NOT NULL DEFAULT '{}',
    -- e.g. {"similar_work":0.72,"reliability":0.80,"skills":0.60,"capacity":0.85,"composite":0.75}
    explanation TEXT,
    -- JSON array of {employeeId, name, compositeScore, explanation}
    alternatives JSONB NOT NULL DEFAULT '[]',
    -- Lifecycle
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'overridden', 'dismissed', 'no_match')),
    approved_by UUID,           -- user_id who approved / overrode
    final_assignee_id UUID REFERENCES employee_profiles(id) ON DELETE SET NULL,
    override_reason TEXT,
    confidence VARCHAR(10) NOT NULL DEFAULT 'high'
        CHECK (confidence IN ('high', 'medium', 'low')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignment_rec_task ON assignment_recommendations (task_id);
CREATE INDEX IF NOT EXISTS idx_assignment_rec_org ON assignment_recommendations (organisation_id);
CREATE INDEX IF NOT EXISTS idx_assignment_rec_status ON assignment_recommendations (organisation_id) WHERE status = 'pending';
