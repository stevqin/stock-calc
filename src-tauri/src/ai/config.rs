use super::{credentials::SecretStore, gateway, types::*};
use rusqlite::{params, Connection, OptionalExtension};
fn encode<T: serde::Serialize>(value: &T) -> AiResult<String> {
    serde_json::to_string(value).map_err(|_| AiError::storage())
}
fn invalid(message: &str) -> AiError {
    AiError::new("invalidConfig", message)
}
fn existing(db: &Connection, id: &str) -> AiResult<(ModelConfig, String)> {
    let row: Option<(String, String)> = db
        .query_row(
            "SELECT payload,credential_ref FROM ai_models WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|_| AiError::storage())?;
    let (payload, reference) =
        row.ok_or_else(|| AiError::new("modelNotFound", "模型配置不存在"))?;
    Ok((
        serde_json::from_str(&payload).map_err(|_| AiError::storage())?,
        reference,
    ))
}
pub fn list_models(db: &Connection) -> AiResult<Vec<ModelConfig>> {
    let mut stmt = db
        .prepare("SELECT payload FROM ai_models ORDER BY rowid")
        .map_err(|_| AiError::storage())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|_| AiError::storage())?;
    rows.map(|r| {
        serde_json::from_str(&r.map_err(|_| AiError::storage())?).map_err(|_| AiError::storage())
    })
    .collect()
}
pub fn get_defaults(db: &Connection) -> AiResult<ModelDefaults> {
    let s: Option<String> = db
        .query_row("SELECT payload FROM ai_defaults WHERE id=1", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(|_| AiError::storage())?;
    s.map(|s| serde_json::from_str(&s).map_err(|_| AiError::storage()))
        .unwrap_or_else(|| Ok(ModelDefaults::default()))
}
pub fn save_defaults(db: &Connection, d: &ModelDefaults) -> AiResult<()> {
    let mut unique = std::collections::HashSet::new();
    for id in &d.participant_ids {
        if !unique.insert(id) || !existing(db, id)?.0.enabled {
            return Err(invalid("默认参与模型必须启用且不能重复"));
        }
    }
    if let Some(id) = &d.summary_model_id {
        if !existing(db, id)?.0.enabled {
            return Err(invalid("默认汇总模型必须启用"));
        }
    }
    db.execute("INSERT INTO ai_defaults VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",[encode(d)?]).map_err(|_|AiError::storage())?;
    Ok(())
}
fn remove_from_defaults(db: &Connection, id: &str) -> AiResult<()> {
    let mut d = get_defaults(db)?;
    d.participant_ids.retain(|x| x != id);
    if d.summary_model_id.as_deref() == Some(id) {
        d.summary_model_id = None;
    }
    save_defaults(db, &d)
}
fn queue_cleanup(db: &Connection, r: &str) -> AiResult<()> {
    if !r.is_empty() {
        db.execute(
            "INSERT OR IGNORE INTO ai_credential_cleanup(reference) VALUES(?1)",
            [r],
        )
        .map_err(|_| AiError::storage())?;
    }
    Ok(())
}
pub fn cleanup_pending(db: &Connection, secrets: &dyn SecretStore) -> AiResult<()> {
    let mut stmt = db
        .prepare("SELECT reference FROM ai_credential_cleanup")
        .map_err(|_| AiError::storage())?;
    let refs = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|_| AiError::storage())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| AiError::storage())?;
    drop(stmt);
    for r in refs {
        if secrets.delete(&r).is_ok() {
            db.execute("DELETE FROM ai_credential_cleanup WHERE reference=?1", [r])
                .map_err(|_| AiError::storage())?;
        }
    }
    Ok(())
}
pub fn save_model(
    db: &mut Connection,
    secrets: &dyn SecretStore,
    input: ModelConfigInput,
    replacement: Option<String>,
) -> AiResult<ModelConfig> {
    for (s, max) in [
        (&input.display_name, 80),
        (&input.provider, 64),
        (&input.model, 256),
    ] {
        if s.trim().is_empty() || s.len() > max || s.chars().any(char::is_control) {
            return Err(invalid("显示名称、服务商或模型标识无效"));
        }
    }
    let endpoint = gateway::normalize_endpoint(&input.base_url)?;
    let base_url = endpoint
        .strip_suffix("/chat/completions")
        .unwrap()
        .to_string();
    let previous = input.id.as_deref().map(|id| existing(db, id)).transpose()?;
    let id = previous
        .as_ref()
        .map(|p| p.0.id.clone())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    if replacement.is_none() {
        if let Some((old, reference)) = &previous {
            let old_origin = reqwest::Url::parse(&old.base_url)
                .map_err(|_| invalid("原API地址无效"))?
                .origin();
            let new_origin = reqwest::Url::parse(&base_url).unwrap().origin();
            if !reference.is_empty() && old_origin != new_origin {
                return Err(invalid("更换API主机时必须重新输入对应密钥"));
            }
        }
    }
    let old_ref = previous.as_ref().map(|p| p.1.clone()).unwrap_or_default();
    let replacement = replacement.map(|s| s.trim().to_string());
    if replacement
        .as_ref()
        .is_some_and(|s| s.is_empty() || s.len() > 8192 || s.contains(['\n', '\r']))
    {
        return Err(invalid("密钥不能为空或包含换行"));
    }
    if replacement.is_none() && input.enabled {
        if old_ref.is_empty() {
            return Err(invalid("启用模型需要配置密钥"));
        }
        secrets.get(&old_ref)?;
    }
    let new_ref = if replacement.is_some() {
        uuid::Uuid::new_v4().to_string()
    } else {
        old_ref.clone()
    };
    let config = ModelConfig {
        id,
        display_name: input.display_name.trim().into(),
        provider: input.provider.trim().into(),
        model: input.model.trim().into(),
        base_url,
        enabled: input.enabled,
    };
    if let Some(key) = &replacement {
        secrets.set(&new_ref, key)?;
    }
    let persist = (|| -> AiResult<()> {
        let tx = db.transaction().map_err(|_| AiError::storage())?;
        tx.execute("INSERT INTO ai_models VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,credential_ref=excluded.credential_ref",params![config.id,encode(&config)?,new_ref]).map_err(|_|AiError::storage())?;
        if !config.enabled {
            remove_from_defaults(&tx, &config.id)?;
        }
        if old_ref != new_ref {
            queue_cleanup(&tx, &old_ref)?;
        }
        tx.commit().map_err(|_| AiError::storage())?;
        Ok(())
    })();
    if let Err(e) = persist {
        if replacement.is_some() {
            let _ = secrets.delete(&new_ref);
        }
        return Err(e);
    }
    cleanup_pending(db, secrets)?;
    Ok(config)
}
pub fn delete_model(db: &mut Connection, secrets: &dyn SecretStore, id: &str) -> AiResult<()> {
    let (_, reference) = existing(db, id)?;
    let tx = db.transaction().map_err(|_| AiError::storage())?;
    remove_from_defaults(&tx, id)?;
    queue_cleanup(&tx, &reference)?;
    tx.execute("DELETE FROM ai_models WHERE id=?1", [id])
        .map_err(|_| AiError::storage())?;
    tx.commit().map_err(|_| AiError::storage())?;
    cleanup_pending(db, secrets)?;
    let remaining: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM ai_credential_cleanup WHERE reference=?1",
            [reference],
            |r| r.get(0),
        )
        .map_err(|_| AiError::storage())?;
    if remaining > 0 {
        return Err(AiError::new(
            "cleanupPending",
            "配置已删除，旧凭证清理失败；下次保存配置时将重试",
        ));
    }
    Ok(())
}
pub fn secret_for_model(
    db: &Connection,
    secrets: &dyn SecretStore,
    id: &str,
) -> AiResult<(ModelConfig, String)> {
    let (c, r) = existing(db, id)?;
    if !c.enabled {
        return Err(invalid("模型已禁用"));
    }
    if r.is_empty() {
        return Err(invalid("模型没有密钥"));
    }
    let key = secrets.get(&r)?;
    Ok((c, key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;
    #[derive(Default)]
    struct MemorySecrets {
        data: Mutex<HashMap<String, String>>,
        fail_set: bool,
    }
    impl SecretStore for MemorySecrets {
        fn set(&self, r: &str, s: &str) -> AiResult<()> {
            if self.fail_set {
                Err(AiError::new("secretStore", "安全存储不可用"))
            } else {
                self.data.lock().unwrap().insert(r.into(), s.into());
                Ok(())
            }
        }
        fn get(&self, r: &str) -> AiResult<String> {
            self.data
                .lock()
                .unwrap()
                .get(r)
                .cloned()
                .ok_or_else(|| AiError::new("missingSecret", "密钥缺失"))
        }
        fn delete(&self, r: &str) -> AiResult<()> {
            self.data.lock().unwrap().remove(r);
            Ok(())
        }
    }
    fn setup() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        crate::ai::repository::initialize(&db).unwrap();
        db
    }
    fn input() -> ModelConfigInput {
        ModelConfigInput {
            id: None,
            display_name: "模型 A".into(),
            provider: "custom".into(),
            base_url: "https://example.com/v1/".into(),
            model: "test-model".into(),
            enabled: true,
        }
    }
    #[test]
    fn credentials_never_enter_sqlite_or_errors() {
        let mut db = setup();
        let store = MemorySecrets::default();
        let result = save_model(&mut db, &store, input(), Some("secret-fixture-123".into()));
        assert!(result.is_ok());
        let c = result.unwrap();
        let payload: String = db
            .query_row("SELECT payload FROM ai_models", [], |r| r.get(0))
            .unwrap();
        assert!(!payload.contains("secret-fixture-123"));
        assert!(!serde_json::to_string(&c).unwrap().contains("credential"));
        assert_eq!(
            secret_for_model(&db, &store, &c.id).unwrap().1,
            "secret-fixture-123"
        );
        let bad = MemorySecrets {
            fail_set: true,
            ..Default::default()
        };
        let error = save_model(&mut db, &bad, input(), Some("private-key".into())).unwrap_err();
        assert!(!format!("{error:?}").contains("private-key"));
        assert_eq!(list_models(&db).unwrap().len(), 1);
    }
    #[test]
    fn editing_preserves_secret_and_replacement_uses_new_reference() {
        let mut db = setup();
        let store = MemorySecrets::default();
        let c = save_model(&mut db, &store, input(), Some("old".into())).unwrap();
        let mut edit = input();
        edit.id = Some(c.id.clone());
        edit.display_name = "新名称".into();
        save_model(&mut db, &store, edit.clone(), None).unwrap();
        assert_eq!(secret_for_model(&db, &store, &c.id).unwrap().1, "old");
        save_model(&mut db, &store, edit, Some("new".into())).unwrap();
        assert_eq!(secret_for_model(&db, &store, &c.id).unwrap().1, "new");
        assert_eq!(store.data.lock().unwrap().len(), 1);
    }
    #[test]
    fn defaults_only_accept_enabled_existing_models_and_delete_cleans_defaults() {
        let mut db = setup();
        let store = MemorySecrets::default();
        let c = save_model(&mut db, &store, input(), Some("key".into())).unwrap();
        let defaults = ModelDefaults {
            participant_ids: vec![c.id.clone()],
            summary_model_id: Some(c.id.clone()),
        };
        save_defaults(&db, &defaults).unwrap();
        assert!(save_defaults(
            &db,
            &ModelDefaults {
                participant_ids: vec!["unknown".into()],
                summary_model_id: None
            }
        )
        .is_err());
        delete_model(&mut db, &store, &c.id).unwrap();
        assert_eq!(get_defaults(&db).unwrap(), ModelDefaults::default());
        assert!(store.data.lock().unwrap().is_empty());
    }
    #[test]
    fn enabled_requires_secret_and_failed_write_leaves_old_key() {
        let mut db = setup();
        let store = MemorySecrets::default();
        assert!(save_model(&mut db, &store, input(), None).is_err());
        let c = save_model(&mut db, &store, input(), Some("old".into())).unwrap();
        let mut edit = input();
        edit.id = Some(c.id.clone());
        let failing = MemorySecrets {
            data: Mutex::new(store.data.lock().unwrap().clone()),
            fail_set: true,
        };
        assert!(save_model(&mut db, &failing, edit, Some("replacement".into())).is_err());
        assert_eq!(secret_for_model(&db, &store, &c.id).unwrap().1, "old");
    }

    #[test]
    fn changing_host_requires_explicit_replacement_secret() {
        let mut db = setup();
        let store = MemorySecrets::default();
        let c = save_model(&mut db, &store, input(), Some("old".into())).unwrap();
        let mut edit = input();
        edit.id = Some(c.id.clone());
        edit.base_url = "https://different.example/v1".into();
        assert!(save_model(&mut db, &store, edit.clone(), None).is_err());
        assert_eq!(
            list_models(&db).unwrap()[0].base_url,
            "https://example.com/v1"
        );
        assert!(save_model(&mut db, &store, edit, Some("new-host-key".into())).is_ok());
    }

    #[test]
    fn disabled_draft_can_change_address_without_a_key() {
        let mut db = setup();
        let store = MemorySecrets::default();
        let mut draft = input();
        draft.enabled = false;
        let c = save_model(&mut db, &store, draft.clone(), None).unwrap();
        draft.id = Some(c.id);
        draft.base_url = "https://draft.example/v1".into();
        assert!(save_model(&mut db, &store, draft, None).is_ok());
        assert!(store.data.lock().unwrap().is_empty());
    }
}
