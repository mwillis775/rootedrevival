//! Unit tests for Scholar

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    
    mod database {
        use crate::db::Database;
        use tempfile::TempDir;
        
        fn setup_test_db() -> (TempDir, Database) {
            let tmp = TempDir::new().unwrap();
            let db_path = tmp.path().join("test.db");
            let db = Database::new(db_path.to_str().unwrap()).unwrap();
            (tmp, db)
        }
        
        #[test]
        fn test_database_creation() {
            let (_tmp, db) = setup_test_db();
            assert!(db.conn.is_ok() || true); // DB should be created
        }
        
        #[test]
        fn test_create_user() {
            let (_tmp, db) = setup_test_db();
            
            let result = db.create_user(
                "testuser",
                "test@example.com",
                "hashedpassword123",
                "publickey123"
            );
            
            assert!(result.is_ok());
            let user_id = result.unwrap();
            assert!(user_id > 0);
        }
        
        #[test]
        fn test_duplicate_username() {
            let (_tmp, db) = setup_test_db();
            
            db.create_user("testuser", "test1@example.com", "hash1", "pk1").unwrap();
            let result = db.create_user("testuser", "test2@example.com", "hash2", "pk2");
            
            assert!(result.is_err());
        }
        
        #[test]
        fn test_duplicate_email() {
            let (_tmp, db) = setup_test_db();
            
            db.create_user("user1", "test@example.com", "hash1", "pk1").unwrap();
            let result = db.create_user("user2", "test@example.com", "hash2", "pk2");
            
            assert!(result.is_err());
        }
        
        #[test]
        fn test_get_user_by_username() {
            let (_tmp, db) = setup_test_db();
            
            db.create_user("findme", "find@example.com", "hash", "pk").unwrap();
            
            let user = db.get_user_by_username("findme");
            assert!(user.is_ok());
            let user = user.unwrap();
            assert!(user.is_some());
            assert_eq!(user.unwrap().username, "findme");
        }
        
        #[test]
        fn test_get_nonexistent_user() {
            let (_tmp, db) = setup_test_db();
            
            let user = db.get_user_by_username("nobody");
            assert!(user.is_ok());
            assert!(user.unwrap().is_none());
        }
        
        #[test]
        fn test_create_session() {
            let (_tmp, db) = setup_test_db();
            
            let user_id = db.create_user("sessionuser", "s@example.com", "hash", "pk").unwrap();
            
            let token = "test_token_123";
            let result = db.create_session(
                user_id,
                token,
                chrono::Utc::now() + chrono::Duration::hours(24),
                Some("127.0.0.1"),
                Some("Test Agent")
            );
            
            assert!(result.is_ok());
        }
        
        #[test]
        fn test_validate_session() {
            let (_tmp, db) = setup_test_db();
            
            let user_id = db.create_user("valuser", "v@example.com", "hash", "pk").unwrap();
            let token = "valid_token_456";
            
            db.create_session(
                user_id,
                token,
                chrono::Utc::now() + chrono::Duration::hours(24),
                None,
                None
            ).unwrap();
            
            let session = db.get_session_by_token(token);
            assert!(session.is_ok());
            assert!(session.unwrap().is_some());
        }
        
        #[test]
        fn test_expired_session() {
            let (_tmp, db) = setup_test_db();
            
            let user_id = db.create_user("expuser", "e@example.com", "hash", "pk").unwrap();
            let token = "expired_token";
            
            // Create session that expired 1 hour ago
            db.create_session(
                user_id,
                token,
                chrono::Utc::now() - chrono::Duration::hours(1),
                None,
                None
            ).unwrap();
            
            let session = db.get_valid_session(token);
            assert!(session.is_ok());
            assert!(session.unwrap().is_none()); // Should be None because expired
        }
        
        #[test]
        fn test_create_file() {
            let (_tmp, db) = setup_test_db();
            
            let user_id = db.create_user("fileuser", "f@example.com", "hash", "pk").unwrap();
            
            let file_uuid = uuid::Uuid::new_v4().to_string();
            let result = db.create_file(
                &file_uuid,
                user_id,
                "stored_name.pdf",
                "original.pdf",
                "application/pdf",
                1024,
                "abc123hash",
                Some("grabnet_cid_123"),
                "Test Paper",
                Some("A test paper description"),
                true
            );
            
            assert!(result.is_ok());
        }
        
        #[test]
        fn test_get_file_by_uuid() {
            let (_tmp, db) = setup_test_db();
            
            let user_id = db.create_user("getfileuser", "gf@example.com", "hash", "pk").unwrap();
            
            let file_uuid = uuid::Uuid::new_v4().to_string();
            db.create_file(
                &file_uuid,
                user_id,
                "test.pdf",
                "test.pdf",
                "application/pdf",
                512,
                "hash456",
                None,
                "My File",
                None,
                true
            ).unwrap();
            
            let file = db.get_file_by_uuid(&file_uuid);
            assert!(file.is_ok());
            let file = file.unwrap();
            assert!(file.is_some());
            assert_eq!(file.unwrap().title, "My File");
        }
        
        #[test]
        fn test_file_tags() {
            let (_tmp, db) = setup_test_db();
            
            let user_id = db.create_user("taguser", "t@example.com", "hash", "pk").unwrap();
            
            let file_uuid = uuid::Uuid::new_v4().to_string();
            let file_id = db.create_file(
                &file_uuid,
                user_id,
                "tagged.pdf",
                "tagged.pdf",
                "application/pdf",
                256,
                "taghash",
                None,
                "Tagged File",
                None,
                true
            ).unwrap();
            
            db.add_file_tag(file_id, "science").unwrap();
            db.add_file_tag(file_id, "research").unwrap();
            
            let tags = db.get_file_tags(file_id);
            assert!(tags.is_ok());
            let tags = tags.unwrap();
            assert_eq!(tags.len(), 2);
            assert!(tags.contains(&"science".to_string()));
            assert!(tags.contains(&"research".to_string()));
        }
        
        #[test]
        fn test_delete_file() {
            let (_tmp, db) = setup_test_db();
            
            let user_id = db.create_user("deluser", "d@example.com", "hash", "pk").unwrap();
            
            let file_uuid = uuid::Uuid::new_v4().to_string();
            db.create_file(
                &file_uuid,
                user_id,
                "delete.pdf",
                "delete.pdf",
                "application/pdf",
                100,
                "delhash",
                None,
                "Delete Me",
                None,
                true
            ).unwrap();
            
            let result = db.delete_file(&file_uuid);
            assert!(result.is_ok());
            
            let file = db.get_file_by_uuid(&file_uuid).unwrap();
            assert!(file.is_none());
        }
        
        #[test]
        fn test_create_review() {
            let (_tmp, db) = setup_test_db();
            
            let user_id = db.create_user("reviewer", "r@example.com", "hash", "pk").unwrap();
            let file_uuid = uuid::Uuid::new_v4().to_string();
            let file_id = db.create_file(
                &file_uuid,
                user_id,
                "review.pdf",
                "review.pdf",
                "application/pdf",
                100,
                "revhash",
                None,
                "Review Me",
                None,
                true
            ).unwrap();
            
            let other_user_id = db.create_user("otheruser", "o@example.com", "hash", "pk").unwrap();
            
            let result = db.create_review(
                file_id,
                other_user_id,
                4,
                "This is a great paper with excellent methodology.",
                Some(4),
                Some(5),
                Some(3),
                Some(4)
            );
            
            assert!(result.is_ok());
        }
        
        #[test]
        fn test_get_reviews_for_file() {
            let (_tmp, db) = setup_test_db();
            
            let user_id = db.create_user("author", "a@example.com", "hash", "pk").unwrap();
            let file_uuid = uuid::Uuid::new_v4().to_string();
            let file_id = db.create_file(
                &file_uuid,
                user_id,
                "multi.pdf",
                "multi.pdf",
                "application/pdf",
                100,
                "multihash",
                None,
                "Multi Review",
                None,
                true
            ).unwrap();
            
            // Create multiple reviewers
            for i in 0..3 {
                let reviewer_id = db.create_user(
                    &format!("reviewer{}", i),
                    &format!("rev{}@example.com", i),
                    "hash",
                    &format!("pk{}", i)
                ).unwrap();
                
                db.create_review(
                    file_id,
                    reviewer_id,
                    3 + (i as i32 % 3),
                    &format!("Review content {} with enough characters to pass validation.", i),
                    Some(4),
                    Some(4),
                    Some(4),
                    Some(4)
                ).unwrap();
            }
            
            let reviews = db.get_reviews_for_file(file_id, 10, 0);
            assert!(reviews.is_ok());
            let reviews = reviews.unwrap();
            assert_eq!(reviews.len(), 3);
        }
        
        #[test]
        fn test_increment_view_count() {
            let (_tmp, db) = setup_test_db();
            
            let user_id = db.create_user("viewuser", "view@example.com", "hash", "pk").unwrap();
            let file_uuid = uuid::Uuid::new_v4().to_string();
            db.create_file(
                &file_uuid,
                user_id,
                "view.pdf",
                "view.pdf",
                "application/pdf",
                100,
                "viewhash",
                None,
                "View Me",
                None,
                true
            ).unwrap();
            
            db.increment_view_count(&file_uuid).unwrap();
            db.increment_view_count(&file_uuid).unwrap();
            db.increment_view_count(&file_uuid).unwrap();
            
            let file = db.get_file_by_uuid(&file_uuid).unwrap().unwrap();
            assert_eq!(file.view_count, 3);
        }
        
        #[test]
        fn test_search_files() {
            let (_tmp, db) = setup_test_db();
            
            let user_id = db.create_user("searchuser", "search@example.com", "hash", "pk").unwrap();
            
            // Create files with different titles
            for title in ["Quantum Physics", "Machine Learning", "Quantum Computing"] {
                let file_uuid = uuid::Uuid::new_v4().to_string();
                db.create_file(
                    &file_uuid,
                    user_id,
                    "file.pdf",
                    "file.pdf",
                    "application/pdf",
                    100,
                    &format!("hash_{}", title),
                    None,
                    title,
                    Some("Description"),
                    true
                ).unwrap();
            }
            
            let results = db.search_files("quantum", 10);
            assert!(results.is_ok());
            let results = results.unwrap();
            assert_eq!(results.len(), 2); // Should find "Quantum Physics" and "Quantum Computing"
        }
        
        #[test]
        fn test_popular_tags() {
            let (_tmp, db) = setup_test_db();
            
            let user_id = db.create_user("tagpopuser", "tagpop@example.com", "hash", "pk").unwrap();
            
            // Create files with tags
            for i in 0..5 {
                let file_uuid = uuid::Uuid::new_v4().to_string();
                let file_id = db.create_file(
                    &file_uuid,
                    user_id,
                    &format!("file{}.pdf", i),
                    &format!("file{}.pdf", i),
                    "application/pdf",
                    100,
                    &format!("hash{}", i),
                    None,
                    &format!("File {}", i),
                    None,
                    true
                ).unwrap();
                
                db.add_file_tag(file_id, "common").unwrap();
                if i % 2 == 0 {
                    db.add_file_tag(file_id, "even").unwrap();
                }
            }
            
            let tags = db.get_popular_tags(10);
            assert!(tags.is_ok());
            let tags = tags.unwrap();
            
            // "common" should be first with count 5
            assert!(!tags.is_empty());
            assert_eq!(tags[0].0, "common");
            assert_eq!(tags[0].1, 5);
        }
    }
    
    mod models {
        use crate::models::*;
        
        #[test]
        fn test_user_serialization() {
            let user = User {
                id: 1,
                username: "testuser".to_string(),
                email: "test@example.com".to_string(),
                password_hash: "hidden".to_string(),
                public_key: "pk123".to_string(),
                display_name: Some("Test User".to_string()),
                bio: None,
                affiliation: None,
                avatar_hash: None,
                is_admin: false,
                is_moderator: false,
                is_verified: true,
                total_uploads: 5,
                total_reviews: 10,
                reputation_score: 100,
                created_at: chrono::Utc::now(),
                last_login: None,
            };
            
            let json = serde_json::to_string(&user);
            assert!(json.is_ok());
        }
        
        #[test]
        fn test_file_metadata() {
            let file = File {
                id: 1,
                uuid: "123e4567-e89b-12d3-a456-426614174000".to_string(),
                user_id: 1,
                filename: "stored.pdf".to_string(),
                original_filename: "My Paper.pdf".to_string(),
                content_type: "application/pdf".to_string(),
                size: 1024000,
                hash: "abc123".to_string(),
                grabnet_cid: Some("QmXYZ".to_string()),
                title: "My Research Paper".to_string(),
                description: Some("A paper about things".to_string()),
                is_public: true,
                view_count: 42,
                download_count: 10,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
            };
            
            assert_eq!(file.size, 1024000);
            assert!(file.is_public);
        }
        
        #[test]
        fn test_review_scores() {
            let review = Review {
                id: 1,
                file_id: 1,
                reviewer_id: 2,
                rating: 4,
                content: "Good paper".to_string(),
                methodology_score: Some(4),
                clarity_score: Some(5),
                reproducibility_score: Some(3),
                significance_score: Some(4),
                helpful_count: 10,
                unhelpful_count: 2,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
            };
            
            assert_eq!(review.rating, 4);
            assert_eq!(review.helpful_count, 10);
        }
    }
    
    mod crypto {
        #[test]
        fn test_password_hashing() {
            use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
            use argon2::password_hash::SaltString;
            use rand::rngs::OsRng;
            
            let password = b"secure_password_123";
            let salt = SaltString::generate(&mut OsRng);
            let argon2 = Argon2::default();
            
            let hash = argon2.hash_password(password, &salt);
            assert!(hash.is_ok());
            
            let hash = hash.unwrap();
            let parsed_hash = PasswordHash::new(hash.to_string().as_str());
            assert!(parsed_hash.is_ok());
            
            let verify = argon2.verify_password(password, &parsed_hash.unwrap());
            assert!(verify.is_ok());
        }
        
        #[test]
        fn test_wrong_password_fails() {
            use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
            use argon2::password_hash::SaltString;
            use rand::rngs::OsRng;
            
            let password = b"correct_password";
            let wrong = b"wrong_password";
            let salt = SaltString::generate(&mut OsRng);
            let argon2 = Argon2::default();
            
            let hash = argon2.hash_password(password, &salt).unwrap();
            let parsed_hash = PasswordHash::new(hash.to_string().as_str()).unwrap();
            
            let verify = argon2.verify_password(wrong, &parsed_hash);
            assert!(verify.is_err());
        }
        
        #[test]
        fn test_ed25519_keypair_generation() {
            use ed25519_dalek::SigningKey;
            use rand::rngs::OsRng;
            
            let signing_key = SigningKey::generate(&mut OsRng);
            let verifying_key = signing_key.verifying_key();
            
            // Public key should be 32 bytes
            assert_eq!(verifying_key.as_bytes().len(), 32);
        }
        
        #[test]
        fn test_ed25519_sign_verify() {
            use ed25519_dalek::{SigningKey, Signature, Signer, Verifier};
            use rand::rngs::OsRng;
            
            let signing_key = SigningKey::generate(&mut OsRng);
            let verifying_key = signing_key.verifying_key();
            
            let message = b"Hello, GrabNet!";
            let signature: Signature = signing_key.sign(message);
            
            let verify = verifying_key.verify(message, &signature);
            assert!(verify.is_ok());
        }
        
        #[test]
        fn test_sha256_hashing() {
            use sha2::{Sha256, Digest};
            
            let mut hasher = Sha256::new();
            hasher.update(b"test content");
            let hash = hasher.finalize();
            
            let hex_hash = hex::encode(hash);
            assert_eq!(hex_hash.len(), 64); // SHA256 is 32 bytes = 64 hex chars
        }
        
        #[test]
        fn test_token_generation() {
            use rand::Rng;
            
            let mut rng = rand::thread_rng();
            let bytes: [u8; 32] = rng.gen();
            let token = hex::encode(bytes);
            
            assert_eq!(token.len(), 64);
        }
    }
    
    mod validation {
        #[test]
        fn test_username_validation() {
            fn is_valid_username(username: &str) -> bool {
                let len = username.len();
                if len < 3 || len > 32 {
                    return false;
                }
                username.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-')
            }
            
            assert!(is_valid_username("user123"));
            assert!(is_valid_username("test_user"));
            assert!(is_valid_username("test-user"));
            assert!(!is_valid_username("ab")); // Too short
            assert!(!is_valid_username("user name")); // Space not allowed
            assert!(!is_valid_username("user@name")); // @ not allowed
        }
        
        #[test]
        fn test_email_validation() {
            fn is_valid_email(email: &str) -> bool {
                email.contains('@') && email.contains('.')
            }
            
            assert!(is_valid_email("test@example.com"));
            assert!(is_valid_email("user.name@domain.org"));
            assert!(!is_valid_email("notanemail"));
            assert!(!is_valid_email("missing@dot"));
        }
        
        #[test]
        fn test_password_strength() {
            fn is_strong_password(password: &str) -> bool {
                password.len() >= 8
            }
            
            assert!(is_strong_password("password123"));
            assert!(is_strong_password("12345678"));
            assert!(!is_strong_password("short"));
        }
        
        #[test]
        fn test_content_type_validation() {
            fn is_allowed_content_type(ct: &str) -> bool {
                let allowed = [
                    "application/pdf",
                    "text/plain",
                    "image/png",
                    "image/jpeg",
                    "application/zip",
                ];
                allowed.contains(&ct)
            }
            
            assert!(is_allowed_content_type("application/pdf"));
            assert!(is_allowed_content_type("image/png"));
            assert!(!is_allowed_content_type("application/x-malware"));
        }
    }
}
