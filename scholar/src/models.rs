//! Data models for Scholar

use chrono::{DateTime, Utc};
use rusqlite::Row;
use serde::{Deserialize, Serialize};
use std::fmt;

// ============================================================================
// Work Type - Core Protocol Type
// ============================================================================

/// Work types define the nature of scholarly work and set review expectations.
/// These are NOT categories of worth - all types are equally valid.
/// They establish what KIND of contribution is being made and how it should be evaluated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkType {
    /// Empirical work: Based on observation, experiment, or data collection
    /// Review focuses on: methodology, reproducibility, data quality, statistical validity
    Empirical,

    /// Theoretical work: Conceptual frameworks, proofs, formal arguments
    /// Review focuses on: logical consistency, novelty, explanatory power, elegance
    Theoretical,

    /// Methodological work: New methods, tools, techniques, protocols
    /// Review focuses on: applicability, improvement over existing methods, documentation
    Methodological,

    /// Artistic work: Creative expression, design, aesthetic exploration
    /// Review focuses on: craft, expression, cultural context, innovation
    Artistic,

    /// Speculative work: Hypotheses, future scenarios, exploratory ideas
    /// Review focuses on: imagination, plausibility, inspiration, clarity of speculation
    Speculative,
}

impl WorkType {
    /// All available work types
    pub fn all() -> &'static [WorkType] {
        &[
            WorkType::Empirical,
            WorkType::Theoretical,
            WorkType::Methodological,
            WorkType::Artistic,
            WorkType::Speculative,
        ]
    }

    /// Get the review criteria applicable to this work type
    pub fn review_criteria(&self) -> ReviewCriteria {
        match self {
            WorkType::Empirical => ReviewCriteria {
                primary: vec![
                    CriterionDef::new(
                        "methodology",
                        "Methodology",
                        "Rigor and appropriateness of research methods",
                    ),
                    CriterionDef::new(
                        "reproducibility",
                        "Reproducibility",
                        "Can the work be independently replicated?",
                    ),
                    CriterionDef::new(
                        "data_quality",
                        "Data Quality",
                        "Accuracy, completeness, and reliability of data",
                    ),
                ],
                secondary: vec![
                    CriterionDef::new(
                        "statistical_validity",
                        "Statistical Validity",
                        "Appropriate use of statistical methods",
                    ),
                    CriterionDef::new(
                        "clarity",
                        "Clarity",
                        "Clear presentation of methods and results",
                    ),
                ],
            },
            WorkType::Theoretical => ReviewCriteria {
                primary: vec![
                    CriterionDef::new(
                        "logical_consistency",
                        "Logical Consistency",
                        "Internal coherence of arguments",
                    ),
                    CriterionDef::new(
                        "novelty",
                        "Novelty",
                        "Originality of theoretical contribution",
                    ),
                    CriterionDef::new(
                        "explanatory_power",
                        "Explanatory Power",
                        "How well does it explain phenomena?",
                    ),
                ],
                secondary: vec![
                    CriterionDef::new(
                        "elegance",
                        "Elegance",
                        "Simplicity and beauty of formulation",
                    ),
                    CriterionDef::new(
                        "generalizability",
                        "Generalizability",
                        "Breadth of applicability",
                    ),
                ],
            },
            WorkType::Methodological => ReviewCriteria {
                primary: vec![
                    CriterionDef::new(
                        "applicability",
                        "Applicability",
                        "Practical usefulness in real contexts",
                    ),
                    CriterionDef::new(
                        "improvement",
                        "Improvement",
                        "Advancement over existing methods",
                    ),
                    CriterionDef::new(
                        "documentation",
                        "Documentation",
                        "Quality of instructions and examples",
                    ),
                ],
                secondary: vec![
                    CriterionDef::new(
                        "accessibility",
                        "Accessibility",
                        "Ease of adoption by others",
                    ),
                    CriterionDef::new(
                        "robustness",
                        "Robustness",
                        "Performance across different conditions",
                    ),
                ],
            },
            WorkType::Artistic => ReviewCriteria {
                primary: vec![
                    CriterionDef::new("craft", "Craft", "Technical skill and execution"),
                    CriterionDef::new(
                        "expression",
                        "Expression",
                        "Effectiveness of artistic communication",
                    ),
                    CriterionDef::new(
                        "innovation",
                        "Innovation",
                        "Creative novelty and originality",
                    ),
                ],
                secondary: vec![
                    CriterionDef::new(
                        "cultural_context",
                        "Cultural Context",
                        "Engagement with cultural discourse",
                    ),
                    CriterionDef::new(
                        "emotional_impact",
                        "Emotional Impact",
                        "Affective resonance with audience",
                    ),
                ],
            },
            WorkType::Speculative => ReviewCriteria {
                primary: vec![
                    CriterionDef::new(
                        "imagination",
                        "Imagination",
                        "Boldness and creativity of ideas",
                    ),
                    CriterionDef::new(
                        "plausibility",
                        "Plausibility",
                        "Internal consistency and feasibility",
                    ),
                    CriterionDef::new(
                        "inspiration",
                        "Inspiration",
                        "Potential to spark further inquiry",
                    ),
                ],
                secondary: vec![
                    CriterionDef::new(
                        "clarity_of_speculation",
                        "Clarity of Speculation",
                        "Clear distinction between known and speculated",
                    ),
                    CriterionDef::new("grounding", "Grounding", "Connection to existing knowledge"),
                ],
            },
        }
    }

    /// Human-readable description
    pub fn description(&self) -> &'static str {
        match self {
            WorkType::Empirical => "Work based on observation, experiment, or data collection",
            WorkType::Theoretical => "Conceptual frameworks, proofs, or formal arguments",
            WorkType::Methodological => "New methods, tools, techniques, or protocols",
            WorkType::Artistic => "Creative expression, design, or aesthetic exploration",
            WorkType::Speculative => "Hypotheses, future scenarios, or exploratory ideas",
        }
    }

    /// Parse from string
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "empirical" => Some(WorkType::Empirical),
            "theoretical" => Some(WorkType::Theoretical),
            "methodological" => Some(WorkType::Methodological),
            "artistic" => Some(WorkType::Artistic),
            "speculative" => Some(WorkType::Speculative),
            _ => None,
        }
    }

    /// Convert to database string
    pub fn as_str(&self) -> &'static str {
        match self {
            WorkType::Empirical => "empirical",
            WorkType::Theoretical => "theoretical",
            WorkType::Methodological => "methodological",
            WorkType::Artistic => "artistic",
            WorkType::Speculative => "speculative",
        }
    }
}

impl fmt::Display for WorkType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl Default for WorkType {
    fn default() -> Self {
        WorkType::Empirical
    }
}

/// Review criteria definition
#[derive(Debug, Clone, Serialize)]
pub struct CriterionDef {
    pub key: String,
    pub name: String,
    pub description: String,
}

impl CriterionDef {
    pub fn new(key: &str, name: &str, description: &str) -> Self {
        Self {
            key: key.to_string(),
            name: name.to_string(),
            description: description.to_string(),
        }
    }
}

/// Review criteria for a work type
#[derive(Debug, Clone, Serialize)]
pub struct ReviewCriteria {
    /// Primary criteria (required for review)
    pub primary: Vec<CriterionDef>,
    /// Secondary criteria (optional but encouraged)
    pub secondary: Vec<CriterionDef>,
}

/// Work type metadata for API responses
#[derive(Debug, Serialize)]
pub struct WorkTypeInfo {
    pub work_type: WorkType,
    pub description: String,
    pub review_criteria: ReviewCriteria,
}

impl From<WorkType> for WorkTypeInfo {
    fn from(wt: WorkType) -> Self {
        Self {
            description: wt.description().to_string(),
            review_criteria: wt.review_criteria(),
            work_type: wt,
        }
    }
}

// ============================================================================
// User models
// ============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub email: Option<String>,
    pub public_key: String,
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub affiliation: Option<String>,
    pub avatar_hash: Option<String>,
    pub is_admin: bool,
    pub is_moderator: bool,
    pub is_verified: bool,
    pub email_verified: bool,
    pub total_uploads: i64,
    pub total_reviews: i64,
    pub reputation_score: i64,
    pub created_at: String,
    pub last_login: Option<String>,
    #[serde(skip)]
    pub role: String,
}

impl User {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        let is_admin = row.get::<_, i64>("is_admin").unwrap_or(0) == 1;
        let is_moderator = row.get::<_, i64>("is_moderator").unwrap_or(0) == 1;

        let role = if is_admin {
            "admin".to_string()
        } else if is_moderator {
            "moderator".to_string()
        } else {
            "user".to_string()
        };

        Ok(Self {
            id: row.get("id")?,
            username: row.get("username")?,
            email: row.get("email").ok(),
            public_key: row.get("public_key")?,
            display_name: row.get("display_name").ok(),
            bio: row.get("bio").ok(),
            affiliation: row.get("affiliation").ok(),
            avatar_hash: row.get("avatar_hash").ok(),
            is_admin,
            is_moderator,
            is_verified: row.get::<_, i64>("is_verified").unwrap_or(0) == 1,
            email_verified: row.get::<_, i64>("email_verified").unwrap_or(0) == 1,
            total_uploads: row.get("total_uploads").unwrap_or(0),
            total_reviews: row.get("total_reviews").unwrap_or(0),
            reputation_score: row.get("reputation_score").unwrap_or(0),
            created_at: row.get("created_at")?,
            last_login: row.get("last_login").ok(),
            role,
        })
    }

    /// Get a safe public view of the user (no email)
    pub fn public_view(&self) -> PublicUser {
        PublicUser {
            username: self.username.clone(),
            public_key: self.public_key.clone(),
            display_name: self.display_name.clone(),
            bio: self.bio.clone(),
            affiliation: self.affiliation.clone(),
            avatar_hash: self.avatar_hash.clone(),
            is_verified: self.is_verified,
            total_uploads: self.total_uploads,
            total_reviews: self.total_reviews,
            reputation_score: self.reputation_score,
            created_at: self.created_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicUser {
    pub username: String,
    pub public_key: String,
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub affiliation: Option<String>,
    pub avatar_hash: Option<String>,
    pub is_verified: bool,
    pub total_uploads: i64,
    pub total_reviews: i64,
    pub reputation_score: i64,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct NewUser {
    pub username: String,
    pub email: Option<String>,
    pub password: String,
    pub public_key: String,
    pub display_name: Option<String>,
}

#[derive(Debug)]
pub struct Session {
    pub id: i64,
    pub user_id: i64,
    pub token: String,
    pub expires_at: DateTime<Utc>,
}

// ============================================================================
// File models
// ============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct File {
    pub id: i64,
    pub uuid: String,
    pub user_id: i64,
    pub username: String,
    pub uploader_name: Option<String>,

    pub filename: String,
    pub original_filename: String,
    pub content_type: String,
    pub size: i64,
    pub hash: String,

    pub grabnet_cid: Option<String>,

    pub title: Option<String>,
    pub description: Option<String>,
    pub is_public: bool,

    /// The type of scholarly work - determines review criteria
    pub work_type: WorkType,

    pub view_count: i64,
    pub download_count: i64,

    pub tags: Vec<String>,

    pub created_at: String,
    pub updated_at: String,
}

impl File {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        // Parse work_type from database string, default to Empirical for legacy data
        let work_type_str: String = row
            .get("work_type")
            .unwrap_or_else(|_| "empirical".to_string());
        let work_type = WorkType::from_str(&work_type_str).unwrap_or(WorkType::Empirical);

        Ok(Self {
            id: row.get("id")?,
            uuid: row.get("uuid")?,
            user_id: row.get("user_id")?,
            username: row.get("username").unwrap_or_else(|_| String::new()),
            uploader_name: row.get("uploader_name").ok(),

            filename: row.get("filename")?,
            original_filename: row.get("original_filename")?,
            content_type: row.get("content_type")?,
            size: row.get("size")?,
            hash: row.get("hash")?,

            grabnet_cid: row.get("grabnet_cid").ok(),

            title: row.get("title").ok(),
            description: row.get("description").ok(),
            is_public: row.get::<_, i64>("is_public").unwrap_or(1) == 1,

            work_type,

            view_count: row.get("view_count").unwrap_or(0),
            download_count: row.get("download_count").unwrap_or(0),

            tags: Vec::new(), // Filled in separately

            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }

    /// Get the review criteria for this file's work type
    pub fn review_criteria(&self) -> ReviewCriteria {
        self.work_type.review_criteria()
    }
}

#[derive(Debug)]
pub struct NewFile {
    pub uuid: String,
    pub user_id: i64,
    pub filename: String,
    pub original_filename: String,
    pub content_type: String,
    pub size: i64,
    pub hash: String,
    pub grabnet_cid: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub is_public: bool,
    pub work_type: WorkType,
}

// ============================================================================
// Review models
// ============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct Review {
    pub id: i64,
    pub file_id: i64,
    pub reviewer_id: i64,
    pub reviewer_username: String,
    pub reviewer_name: Option<String>,

    pub rating: i32,
    pub content: Option<String>,

    /// Dynamic criteria scores (keys match work type criteria)
    pub criteria_scores: std::collections::HashMap<String, i32>,

    // Legacy fields for backward compatibility
    pub methodology_score: Option<i32>,
    pub clarity_score: Option<i32>,
    pub reproducibility_score: Option<i32>,
    pub significance_score: Option<i32>,

    pub helpful_count: i64,
    pub unhelpful_count: i64,

    pub created_at: String,
    pub updated_at: String,
}

impl Review {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        // Parse criteria_scores from JSON string
        let criteria_json: String = row
            .get("criteria_scores")
            .unwrap_or_else(|_| "{}".to_string());
        let criteria_scores: std::collections::HashMap<String, i32> =
            serde_json::from_str(&criteria_json).unwrap_or_default();

        Ok(Self {
            id: row.get("id")?,
            file_id: row.get("file_id")?,
            reviewer_id: row.get("reviewer_id")?,
            reviewer_username: row
                .get("reviewer_username")
                .unwrap_or_else(|_| String::new()),
            reviewer_name: row.get("reviewer_name").ok(),

            rating: row.get("rating")?,
            content: row.get("content").ok(),

            criteria_scores,

            methodology_score: row.get("methodology_score").ok(),
            clarity_score: row.get("clarity_score").ok(),
            reproducibility_score: row.get("reproducibility_score").ok(),
            significance_score: row.get("significance_score").ok(),

            helpful_count: row.get("helpful_count").unwrap_or(0),
            unhelpful_count: row.get("unhelpful_count").unwrap_or(0),

            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

#[derive(Debug)]
pub struct NewReview {
    pub file_id: i64,
    pub reviewer_id: i64,
    pub rating: i32,
    pub content: Option<String>,
    /// Dynamic criteria scores
    pub criteria_scores: std::collections::HashMap<String, i32>,
    // Legacy fields
    pub methodology_score: Option<i32>,
    pub clarity_score: Option<i32>,
    pub reproducibility_score: Option<i32>,
    pub significance_score: Option<i32>,
}

// ============================================================================
// API request/response types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub email: Option<String>,
    pub password: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub success: bool,
    pub user: Option<PublicUser>,
    pub token: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ApiError {
    pub error: String,
}

#[derive(Debug, Default, Deserialize)]
pub struct UploadMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub is_public: bool,
    /// The type of scholarly work - determines review expectations
    pub work_type: Option<String>,
}

impl UploadMetadata {
    /// Parse work_type string into WorkType enum
    pub fn parsed_work_type(&self) -> WorkType {
        self.work_type
            .as_ref()
            .and_then(|s| WorkType::from_str(s))
            .unwrap_or(WorkType::Empirical)
    }
}

#[derive(Debug, Deserialize)]
pub struct ReviewRequest {
    pub rating: i32,
    pub content: Option<String>,
    /// Dynamic criteria scores - keys match the work type's criteria
    #[serde(default)]
    pub criteria_scores: std::collections::HashMap<String, i32>,
    // Legacy fields for backward compatibility
    pub methodology_score: Option<i32>,
    pub clarity_score: Option<i32>,
    pub reproducibility_score: Option<i32>,
    pub significance_score: Option<i32>,
}

/// Review statistics for a file
#[derive(Debug, Serialize)]
pub struct ReviewStats {
    pub count: i64,
    pub avg_rating: f64,
    pub avg_methodology: Option<f64>,
    pub avg_clarity: Option<f64>,
    pub avg_reproducibility: Option<f64>,
    pub avg_significance: Option<f64>,
}

// ============================================================================
// Domain-Scoped Reputation
// One identity, many reputational contexts
// ============================================================================

/// Reputation earned in a specific domain (work type)
/// A scientist's physics reputation doesn't transfer to art criticism
#[derive(Debug, Clone, Serialize)]
pub struct DomainReputation {
    pub user_id: i64,
    pub domain: WorkType,
    pub reputation_score: i64,
    pub contribution_count: i64,
    pub review_count: i64,
    pub helpful_reviews: i64,
}

impl DomainReputation {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        let domain_str: String = row.get("domain")?;
        Ok(Self {
            user_id: row.get("user_id")?,
            domain: WorkType::from_str(&domain_str).unwrap_or(WorkType::Empirical),
            reputation_score: row.get("reputation_score").unwrap_or(0),
            contribution_count: row.get("contribution_count").unwrap_or(0),
            review_count: row.get("review_count").unwrap_or(0),
            helpful_reviews: row.get("helpful_reviews").unwrap_or(0),
        })
    }
}

// ============================================================================
// Result Types - Explicit support for negative space
// ============================================================================

/// Result type indicates what kind of outcome this work represents
/// Null results, failed experiments, and unresolved works are explicitly valid
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResultType {
    /// Positive: Confirms hypothesis, achieves goal, demonstrates success
    Positive,
    /// Null: No significant result found - equally valuable for science
    Null,
    /// Negative: Disproves hypothesis, unexpected failure - teaches what doesn't work
    Negative,
    /// Inconclusive: Insufficient evidence either way - honest about limitations
    Inconclusive,
    /// Unresolved: Intentionally leaves questions open (artistic/speculative work)
    Unresolved,
    /// Exploratory: Not seeking specific result, process-focused
    Exploratory,
}

impl ResultType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ResultType::Positive => "positive",
            ResultType::Null => "null",
            ResultType::Negative => "negative",
            ResultType::Inconclusive => "inconclusive",
            ResultType::Unresolved => "unresolved",
            ResultType::Exploratory => "exploratory",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "positive" => Some(ResultType::Positive),
            "null" => Some(ResultType::Null),
            "negative" => Some(ResultType::Negative),
            "inconclusive" => Some(ResultType::Inconclusive),
            "unresolved" => Some(ResultType::Unresolved),
            "exploratory" => Some(ResultType::Exploratory),
            _ => None,
        }
    }

    pub fn description(&self) -> &'static str {
        match self {
            ResultType::Positive => "Confirms hypothesis or achieves stated goal",
            ResultType::Null => {
                "No significant result found - valuable for knowing what to explore next"
            }
            ResultType::Negative => {
                "Disproves hypothesis or reveals unexpected failure - teaches what doesn't work"
            }
            ResultType::Inconclusive => {
                "Insufficient evidence either way - honest about limitations"
            }
            ResultType::Unresolved => {
                "Intentionally leaves questions open (common in artistic/speculative work)"
            }
            ResultType::Exploratory => "Process-focused work not seeking specific result",
        }
    }
}

impl Default for ResultType {
    fn default() -> Self {
        ResultType::Positive
    }
}

// ============================================================================
// Version Status - Visible revision history
// ============================================================================

/// Version status for transparent revision tracking
/// Drafts, revisions, retractions are visible - not hidden
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VersionStatus {
    /// Draft: Work in progress, not yet finalized
    Draft,
    /// Published: Current active version
    Published,
    /// Revision: Updated version superseding previous
    Revision,
    /// Retracted: Author has withdrawn this version (with explanation)
    Retracted,
    /// Retired: Author has retired this work (still visible, not promoted)
    Retired,
    /// Abandoned: Author explicitly abandoned this direction (visible as learning)
    Abandoned,
}

impl VersionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            VersionStatus::Draft => "draft",
            VersionStatus::Published => "published",
            VersionStatus::Revision => "revision",
            VersionStatus::Retracted => "retracted",
            VersionStatus::Retired => "retired",
            VersionStatus::Abandoned => "abandoned",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "draft" => Some(VersionStatus::Draft),
            "published" => Some(VersionStatus::Published),
            "revision" => Some(VersionStatus::Revision),
            "retracted" => Some(VersionStatus::Retracted),
            "retired" => Some(VersionStatus::Retired),
            "abandoned" => Some(VersionStatus::Abandoned),
            _ => None,
        }
    }
}

/// A specific version of a work
#[derive(Debug, Clone, Serialize)]
pub struct FileVersion {
    pub file_uuid: String,
    pub version_number: i32,
    pub status: VersionStatus,
    pub content_hash: String,
    pub grabnet_cid: Option<String>,
    pub change_summary: Option<String>,
    pub retraction_reason: Option<String>,
    pub abandonment_note: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Citations - Hash-based references for anything
// ============================================================================

/// Citation type describes the relationship between works
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CitationType {
    /// Simple reference
    Reference,
    /// This work builds upon the cited work
    BuildsOn,
    /// This work responds to or critiques the cited work
    RespondsTo,
    /// This work contradicts the cited work
    Contradicts,
    /// This work replicates/verifies the cited work
    Replicates,
    /// This work uses methodology from the cited work
    UsesMethod,
    /// Artistic influence or lineage
    InfluencedBy,
}

/// A citation linking works together
/// Can reference internal works, external works, or specific hashed elements
#[derive(Debug, Clone, Serialize)]
pub struct Citation {
    pub id: i64,
    pub citing_file_uuid: String,
    pub cited_file_uuid: Option<String>,
    /// Hash of specific element (brushstroke, sound texture, dataset snapshot)
    pub cited_hash: Option<String>,
    /// For external references (DOI, URL, description)
    pub external_reference: Option<String>,
    pub citation_type: CitationType,
    pub context_note: Option<String>,
    /// For timestamped citations (e.g., "3:45" in a video)
    pub timestamp_ref: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Visibility & Time - Work breathes with time
// ============================================================================

/// Visibility status for temporal management
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VisibilityStatus {
    /// Active: Normally visible
    Active,
    /// Dormant: Low engagement, naturally faded from prominence
    Dormant,
    /// Retired: Author has retired this work (still accessible, not promoted)
    Retired,
    /// Resurfaced: Old work that became relevant again
    Resurfaced,
}

impl VisibilityStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            VisibilityStatus::Active => "active",
            VisibilityStatus::Dormant => "dormant",
            VisibilityStatus::Retired => "retired",
            VisibilityStatus::Resurfaced => "resurfaced",
        }
    }
}

// ============================================================================
// Procedural Moderation - Not moral judgment
// ============================================================================

/// Context tags for content - spaces can have different norms
#[derive(Debug, Clone, Serialize)]
pub struct ContentContext {
    pub file_uuid: String,
    pub context_tag: String,
    pub assigned_by: Option<i64>,
    pub assignment_type: String, // "author" or "moderator"
}

/// Moderation action with required reasoning (transparency)
#[derive(Debug, Clone, Serialize)]
pub struct ModerationReasoning {
    pub moderation_log_id: i64,
    pub policy_cited: String,
    pub reasoning: String,
    pub author_notified: bool,
    pub appealable: bool,
    pub appeal_deadline: Option<String>,
}

// ============================================================================
// Sacred Constraints - Immutable principles
// ============================================================================

/// Platform constraints that cannot be violated
#[derive(Debug, Clone, Serialize)]
pub struct SacredConstraint {
    pub id: i64,
    pub constraint_name: String,
    pub description: String,
    pub violation_consequence: String,
}

/// CSAM violation record - zero tolerance
#[derive(Debug, Clone, Serialize)]
pub struct CSAMViolation {
    pub user_id: i64,
    pub violation_count: i32,
    pub reported_to_authorities: bool,
    pub authority_report_reference: Option<String>,
    pub first_violation_at: String,
}
