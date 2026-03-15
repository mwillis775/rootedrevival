//! Integration tests for Scholar API
//! 
//! These tests require a running Scholar server on port 8889.
//! Run with: cargo test --test integration_tests -- --ignored

use reqwest::Client;
use serde_json::{json, Value};
use std::time::Duration;

const BASE_URL: &str = "http://localhost:8889/api";

fn client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap()
}

#[tokio::test]
#[ignore]
async fn test_health_endpoint() {
    let client = client();
    let resp = client
        .get(format!("{}/health", BASE_URL))
        .send()
        .await
        .expect("Health check failed");
    
    assert!(resp.status().is_success());
    
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
    assert_eq!(body["service"], "scholar");
}

#[tokio::test]
#[ignore]
async fn test_status_endpoint() {
    let client = client();
    let resp = client
        .get(format!("{}/status", BASE_URL))
        .send()
        .await
        .expect("Status check failed");
    
    assert!(resp.status().is_success());
    
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
    assert!(body["grabnet"].is_object());
}

#[tokio::test]
#[ignore]
async fn test_tor_endpoint() {
    let client = client();
    let resp = client
        .get(format!("{}/tor", BASE_URL))
        .send()
        .await
        .expect("Tor check failed");
    
    assert!(resp.status().is_success());
    
    let body: Value = resp.json().await.unwrap();
    assert!(body["tor"]["detected"].is_boolean());
}

#[tokio::test]
#[ignore]
async fn test_grabnet_endpoint() {
    let client = client();
    let resp = client
        .get(format!("{}/grabnet", BASE_URL))
        .send()
        .await
        .expect("GrabNet check failed");
    
    assert!(resp.status().is_success());
    
    let body: Value = resp.json().await.unwrap();
    assert!(body["grabnet"].is_object());
}

#[tokio::test]
#[ignore]
async fn test_registration_flow() {
    let client = client();
    let username = format!("testuser_{}", chrono::Utc::now().timestamp());
    
    let resp = client
        .post(format!("{}/auth/register", BASE_URL))
        .json(&json!({
            "username": username,
            "email": format!("{}@test.com", username),
            "password": "testpassword123"
        }))
        .send()
        .await
        .expect("Registration failed");
    
    assert!(resp.status().is_success(), "Registration should succeed");
    
    let body: Value = resp.json().await.unwrap();
    assert!(body["token"].is_string());
    assert!(body["user"]["username"].is_string());
    assert!(body["private_key"].is_string(), "Private key should be returned on registration");
}

#[tokio::test]
#[ignore]
async fn test_duplicate_registration() {
    let client = client();
    let username = format!("dupuser_{}", chrono::Utc::now().timestamp());
    
    // First registration
    client
        .post(format!("{}/auth/register", BASE_URL))
        .json(&json!({
            "username": username,
            "email": format!("{}@test.com", username),
            "password": "testpassword123"
        }))
        .send()
        .await
        .expect("First registration failed");
    
    // Duplicate registration
    let resp = client
        .post(format!("{}/auth/register", BASE_URL))
        .json(&json!({
            "username": username,
            "email": format!("{}_2@test.com", username),
            "password": "testpassword123"
        }))
        .send()
        .await
        .expect("Duplicate registration request failed");
    
    assert!(!resp.status().is_success(), "Duplicate registration should fail");
}

#[tokio::test]
#[ignore]
async fn test_login_flow() {
    let client = client();
    let username = format!("loginuser_{}", chrono::Utc::now().timestamp());
    let password = "loginpassword123";
    
    // Register
    client
        .post(format!("{}/auth/register", BASE_URL))
        .json(&json!({
            "username": username,
            "email": format!("{}@test.com", username),
            "password": password
        }))
        .send()
        .await
        .expect("Registration failed");
    
    // Login
    let resp = client
        .post(format!("{}/auth/login", BASE_URL))
        .json(&json!({
            "username": username,
            "password": password
        }))
        .send()
        .await
        .expect("Login failed");
    
    assert!(resp.status().is_success());
    
    let body: Value = resp.json().await.unwrap();
    assert!(body["token"].is_string());
}

#[tokio::test]
#[ignore]
async fn test_wrong_password() {
    let client = client();
    let username = format!("wrongpw_{}", chrono::Utc::now().timestamp());
    
    // Register
    client
        .post(format!("{}/auth/register", BASE_URL))
        .json(&json!({
            "username": username,
            "email": format!("{}@test.com", username),
            "password": "correctpassword"
        }))
        .send()
        .await
        .expect("Registration failed");
    
    // Wrong password login
    let resp = client
        .post(format!("{}/auth/login", BASE_URL))
        .json(&json!({
            "username": username,
            "password": "wrongpassword"
        }))
        .send()
        .await
        .expect("Login request failed");
    
    assert!(!resp.status().is_success(), "Wrong password should fail");
}

#[tokio::test]
#[ignore]
async fn test_authenticated_me_endpoint() {
    let client = client();
    let username = format!("meuser_{}", chrono::Utc::now().timestamp());
    
    // Register and get token
    let resp = client
        .post(format!("{}/auth/register", BASE_URL))
        .json(&json!({
            "username": username,
            "email": format!("{}@test.com", username),
            "password": "mepassword123"
        }))
        .send()
        .await
        .expect("Registration failed");
    
    let body: Value = resp.json().await.unwrap();
    let token = body["token"].as_str().unwrap();
    
    // Access /me endpoint
    let resp = client
        .get(format!("{}/auth/me", BASE_URL))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .expect("/me request failed");
    
    assert!(resp.status().is_success());
    
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["username"], username);
}

#[tokio::test]
#[ignore]
async fn test_unauthenticated_me_endpoint() {
    let client = client();
    
    let resp = client
        .get(format!("{}/auth/me", BASE_URL))
        .send()
        .await
        .expect("/me request failed");
    
    assert!(!resp.status().is_success(), "Unauthenticated /me should fail");
}

#[tokio::test]
#[ignore]
async fn test_browse_recent() {
    let client = client();
    
    let resp = client
        .get(format!("{}/browse/recent", BASE_URL))
        .send()
        .await
        .expect("Browse recent failed");
    
    assert!(resp.status().is_success());
    
    let body: Value = resp.json().await.unwrap();
    assert!(body["files"].is_array());
}

#[tokio::test]
#[ignore]
async fn test_search_files() {
    let client = client();
    
    let resp = client
        .get(format!("{}/browse/search?q=test", BASE_URL))
        .send()
        .await
        .expect("Search failed");
    
    assert!(resp.status().is_success());
    
    let body: Value = resp.json().await.unwrap();
    assert!(body["files"].is_array());
}

#[tokio::test]
#[ignore]
async fn test_tags_endpoint() {
    let client = client();
    
    let resp = client
        .get(format!("{}/tags", BASE_URL))
        .send()
        .await
        .expect("Tags request failed");
    
    assert!(resp.status().is_success());
    
    let body: Value = resp.json().await.unwrap();
    assert!(body["tags"].is_array());
}

#[tokio::test]
#[ignore]
async fn test_recent_reviews() {
    let client = client();
    
    let resp = client
        .get(format!("{}/reviews/recent", BASE_URL))
        .send()
        .await
        .expect("Recent reviews failed");
    
    assert!(resp.status().is_success());
    
    let body: Value = resp.json().await.unwrap();
    assert!(body["reviews"].is_array());
}

#[tokio::test]
#[ignore]
async fn test_file_upload_requires_auth() {
    let client = client();
    
    let form = reqwest::multipart::Form::new()
        .text("metadata", r#"{"title":"Test","is_public":true}"#);
    
    let resp = client
        .post(format!("{}/files", BASE_URL))
        .multipart(form)
        .send()
        .await
        .expect("Upload request failed");
    
    assert!(!resp.status().is_success(), "Upload without auth should fail");
}

#[tokio::test]
#[ignore]
async fn test_admin_requires_auth() {
    let client = client();
    
    let resp = client
        .get(format!("{}/admin/stats", BASE_URL))
        .send()
        .await
        .expect("Admin stats request failed");
    
    assert!(!resp.status().is_success(), "Admin without auth should fail");
}

#[tokio::test]
#[ignore]
async fn test_csrf_token() {
    let client = client();
    
    let resp = client
        .get(format!("{}/csrf-token", BASE_URL))
        .send()
        .await
        .expect("CSRF token request failed");
    
    assert!(resp.status().is_success());
    
    let body: Value = resp.json().await.unwrap();
    assert!(body["csrf_token"].is_string());
}

#[tokio::test]
#[ignore]
async fn test_profile_endpoint() {
    let client = client();
    let username = format!("profileuser_{}", chrono::Utc::now().timestamp());
    
    // Register
    client
        .post(format!("{}/auth/register", BASE_URL))
        .json(&json!({
            "username": username,
            "email": format!("{}@test.com", username),
            "password": "profilepass123"
        }))
        .send()
        .await
        .expect("Registration failed");
    
    // Get profile
    let resp = client
        .get(format!("{}/profiles/{}", BASE_URL, username))
        .send()
        .await
        .expect("Profile request failed");
    
    assert!(resp.status().is_success());
    
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["username"], username);
}

#[tokio::test]
#[ignore]
async fn test_nonexistent_profile() {
    let client = client();
    
    let resp = client
        .get(format!("{}/profiles/nonexistent_user_xyz_123", BASE_URL))
        .send()
        .await
        .expect("Profile request failed");
    
    assert!(!resp.status().is_success(), "Nonexistent profile should 404");
}

#[tokio::test]
#[ignore]
async fn test_file_not_found() {
    let client = client();
    
    let resp = client
        .get(format!("{}/files/00000000-0000-0000-0000-000000000000", BASE_URL))
        .send()
        .await
        .expect("File request failed");
    
    assert_eq!(resp.status().as_u16(), 404);
}

#[tokio::test]
#[ignore]
async fn test_logout() {
    let client = client();
    let username = format!("logoutuser_{}", chrono::Utc::now().timestamp());
    
    // Register
    let resp = client
        .post(format!("{}/auth/register", BASE_URL))
        .json(&json!({
            "username": username,
            "email": format!("{}@test.com", username),
            "password": "logoutpass123"
        }))
        .send()
        .await
        .expect("Registration failed");
    
    let body: Value = resp.json().await.unwrap();
    let token = body["token"].as_str().unwrap();
    
    // Logout
    let resp = client
        .post(format!("{}/auth/logout", BASE_URL))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .expect("Logout failed");
    
    assert!(resp.status().is_success());
    
    // Try to use token after logout
    let resp = client
        .get(format!("{}/auth/me", BASE_URL))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .expect("/me after logout failed");
    
    assert!(!resp.status().is_success(), "Token should be invalid after logout");
}

/// Full integration test: register, upload, review, browse
#[tokio::test]
#[ignore]
async fn test_full_workflow() {
    let client = client();
    let timestamp = chrono::Utc::now().timestamp();
    let author = format!("author_{}", timestamp);
    let reviewer = format!("reviewer_{}", timestamp);
    
    // 1. Register author
    let resp = client
        .post(format!("{}/auth/register", BASE_URL))
        .json(&json!({
            "username": author,
            "email": format!("{}@test.com", author),
            "password": "authorpass123"
        }))
        .send()
        .await
        .expect("Author registration failed");
    
    let body: Value = resp.json().await.unwrap();
    let author_token = body["token"].as_str().unwrap().to_string();
    
    // 2. Register reviewer
    let resp = client
        .post(format!("{}/auth/register", BASE_URL))
        .json(&json!({
            "username": reviewer,
            "email": format!("{}@test.com", reviewer),
            "password": "reviewerpass123"
        }))
        .send()
        .await
        .expect("Reviewer registration failed");
    
    let body: Value = resp.json().await.unwrap();
    let reviewer_token = body["token"].as_str().unwrap().to_string();
    
    // 3. Upload file as author
    let file_content = b"This is test content for the integration test.";
    let form = reqwest::multipart::Form::new()
        .part("file", reqwest::multipart::Part::bytes(file_content.to_vec())
            .file_name("test_paper.txt")
            .mime_str("text/plain")
            .unwrap())
        .text("metadata", json!({
            "title": "Integration Test Paper",
            "description": "A paper for testing",
            "is_public": true,
            "tags": ["test", "integration"]
        }).to_string());
    
    let resp = client
        .post(format!("{}/files", BASE_URL))
        .header("Authorization", format!("Bearer {}", author_token))
        .multipart(form)
        .send()
        .await
        .expect("File upload failed");
    
    assert!(resp.status().is_success(), "Upload should succeed");
    
    let body: Value = resp.json().await.unwrap();
    let file_uuid = body["uuid"].as_str().unwrap().to_string();
    
    // 4. Get file metadata
    let resp = client
        .get(format!("{}/files/{}", BASE_URL, file_uuid))
        .send()
        .await
        .expect("Get file failed");
    
    assert!(resp.status().is_success());
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["title"], "Integration Test Paper");
    
    // 5. Submit review as reviewer
    let resp = client
        .post(format!("{}/files/{}/reviews", BASE_URL, file_uuid))
        .header("Authorization", format!("Bearer {}", reviewer_token))
        .json(&json!({
            "rating": 4,
            "content": "This is a well-written paper that demonstrates the integration testing capabilities of the system. The methodology is sound and the results are reproducible.",
            "methodology_score": 4,
            "clarity_score": 5,
            "reproducibility_score": 4,
            "significance_score": 3
        }))
        .send()
        .await
        .expect("Review creation failed");
    
    assert!(resp.status().is_success(), "Review should succeed");
    
    // 6. Get reviews for file
    let resp = client
        .get(format!("{}/files/{}/reviews", BASE_URL, file_uuid))
        .send()
        .await
        .expect("Get reviews failed");
    
    assert!(resp.status().is_success());
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["reviews"].as_array().unwrap().len(), 1);
    
    // 7. Search for the file
    let resp = client
        .get(format!("{}/browse/search?q=Integration", BASE_URL))
        .send()
        .await
        .expect("Search failed");
    
    assert!(resp.status().is_success());
    let body: Value = resp.json().await.unwrap();
    let files = body["files"].as_array().unwrap();
    assert!(files.iter().any(|f| f["uuid"] == file_uuid));
    
    // 8. Browse by tag
    let resp = client
        .get(format!("{}/browse/tag/integration", BASE_URL))
        .send()
        .await
        .expect("Browse by tag failed");
    
    assert!(resp.status().is_success());
    
    // 9. Delete file as author
    let resp = client
        .delete(format!("{}/files/{}", BASE_URL, file_uuid))
        .header("Authorization", format!("Bearer {}", author_token))
        .send()
        .await
        .expect("Delete file failed");
    
    assert!(resp.status().is_success());
    
    // 10. Verify file is deleted
    let resp = client
        .get(format!("{}/files/{}", BASE_URL, file_uuid))
        .send()
        .await
        .expect("Get deleted file failed");
    
    assert_eq!(resp.status().as_u16(), 404);
}
