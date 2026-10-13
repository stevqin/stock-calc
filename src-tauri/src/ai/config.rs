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
fn stored_key(db: &Connection, id: &str) -> AiResult<Option<String>> {
    db.query_row(
        "SELECT api_key FROM ai_model_keys WHERE model_id=?1",
        [id],
        |r| r.get(0),
    )
    .optional()
    .map_err(|_| AiError::storage())
}
fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 8192 && !key.contains(['\n', '\r'])
}
/// Copy readable legacy keys into SQLite. Returns the number still pending.
/// Original keychain entries are retained; runtime calls read SQLite only.
pub fn migrate_legacy_keys(db: &mut Connection, legacy: &dyn SecretStore) -> AiResult<usize> {
    let rows = {
        let mut stmt = db
            .prepare("SELECT id,credential_ref FROM ai_models WHERE credential_ref<>''")
            .map_err(|_| AiError::storage())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|_| AiError::storage())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| AiError::storage())?;
        rows
    };
    let mut pending = 0;
    for (id, reference) in rows {
        let key = match stored_key(db, &id)? {
            Some(key) => key,
            None => match legacy.get(&reference) {
                Ok(key) if valid_key(&key) => key,
                _ => {
                    pending += 1;
                    continue;
                }
            },
        };
        let tx = db.transaction().map_err(|_| AiError::storage())?;
        tx.execute("INSERT INTO ai_model_keys(model_id,api_key) VALUES(?1,?2) ON CONFLICT(model_id) DO NOTHING", params![id,key])
            .map_err(|_| AiError::storage())?;
        tx.execute("UPDATE ai_models SET credential_ref='' WHERE id=?1", [&id])
            .map_err(|_| AiError::storage())?;
        tx.commit().map_err(|_| AiError::storage())?;
    }
    Ok(pending)
}
pub fn save_model(
    db: &mut Connection,
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
    let old_key = stored_key(db, &id)?;
    if replacement.is_none() {
        if let Some((old, reference)) = &previous {
            let old_origin = reqwest::Url::parse(&old.base_url)
                .map_err(|_| invalid("原API地址无效"))?
                .origin();
            let new_origin = reqwest::Url::parse(&base_url).unwrap().origin();
            if (old_key.is_some() || !reference.is_empty()) && old_origin != new_origin {
                return Err(invalid("更换API主机时必须重新输入对应密钥"));
            }
        }
    }
    let key = replacement.map(|s| s.trim().to_string()).or(old_key);
    if key.as_ref().is_some_and(|s| !valid_key(s)) {
        return Err(invalid("密钥不能为空、超过长度限制或包含换行"));
    }
    if input.enabled && key.is_none() {
        return Err(invalid("启用模型需要配置密钥；旧密钥迁移失败时请重新输入"));
    }
    let config = ModelConfig {
        id,
        display_name: input.display_name.trim().into(),
        provider: input.provider.trim().into(),
        model: input.model.trim().into(),
        base_url,
        enabled: input.enabled,
    };
    let legacy_ref = if key.is_some() {
        String::new()
    } else {
        previous.map(|p| p.1).unwrap_or_default()
    };
    let tx = db.transaction().map_err(|_| AiError::storage())?;
    tx.execute("INSERT INTO ai_models(id,payload,credential_ref) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,credential_ref=excluded.credential_ref",params![config.id,encode(&config)?,legacy_ref]).map_err(|_|AiError::storage())?;
    if let Some(key) = key {
        tx.execute("INSERT INTO ai_model_keys(model_id,api_key) VALUES(?1,?2) ON CONFLICT(model_id) DO UPDATE SET api_key=excluded.api_key",params![config.id,key]).map_err(|_|AiError::storage())?;
    }
    if !config.enabled {
        remove_from_defaults(&tx, &config.id)?;
    }
    tx.commit().map_err(|_| AiError::storage())?;
    Ok(config)
}
pub fn delete_model(db: &mut Connection, id: &str) -> AiResult<()> {
    existing(db, id)?;
    let tx = db.transaction().map_err(|_| AiError::storage())?;
    remove_from_defaults(&tx, id)?;
    tx.execute("DELETE FROM ai_model_keys WHERE model_id=?1", [id])
        .map_err(|_| AiError::storage())?;
    tx.execute("DELETE FROM ai_models WHERE id=?1", [id])
        .map_err(|_| AiError::storage())?;
    tx.commit().map_err(|_| AiError::storage())?;
    Ok(())
}
pub fn secret_for_model(db: &Connection, id: &str) -> AiResult<(ModelConfig, String)> {
    let (c, _) = existing(db, id)?;
    if !c.enabled {
        return Err(invalid("模型已禁用"));
    }
    let key = stored_key(db, id)?.ok_or_else(|| {
        AiError::new(
            "missingSecret",
            "SQLite 中没有可用密钥；旧密钥迁移失败时请编辑模型并重新输入 Key",
        )
    })?;
    if !valid_key(&key) {
        return Err(AiError::new(
            "invalidSecret",
            "数据库中的模型密钥无效，请重新配置",
        ));
    }
    Ok((c, key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::HashMap, sync::Mutex};
    #[derive(Default)]
    struct LegacySecrets(Mutex<HashMap<String, String>>);
    impl SecretStore for LegacySecrets {
        fn set(&self, r: &str, s: &str) -> AiResult<()> {
            self.0.lock().unwrap().insert(r.into(), s.into());
            Ok(())
        }
        fn get(&self, r: &str) -> AiResult<String> {
            self.0
                .lock()
                .unwrap()
                .get(r)
                .cloned()
                .ok_or_else(|| AiError::new("missingSecret", "旧密钥不可读取"))
        }
        fn delete(&self, r: &str) -> AiResult<()> {
            self.0.lock().unwrap().remove(r);
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
    fn sqlite_keys_are_persisted_but_never_in_public_config() {
        let mut db = setup();
        let c = save_model(&mut db, input(), Some("secret-fixture-123".into())).unwrap();
        let key: String = db
            .query_row(
                "SELECT api_key FROM ai_model_keys WHERE model_id=?1",
                [&c.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(key, "secret-fixture-123");
        assert_eq!(secret_for_model(&db, &c.id).unwrap().1, key);
        assert!(!serde_json::to_string(&list_models(&db).unwrap())
            .unwrap()
            .contains(&key));
        assert!(!serde_json::to_string(&c).unwrap().contains(&key));
    }
    #[test]
    fn editing_retains_and_replaces_key_atomically() {
        let mut db = setup();
        let c = save_model(&mut db, input(), Some("old".into())).unwrap();
        let mut edit = input();
        edit.id = Some(c.id.clone());
        edit.display_name = "新名称".into();
        save_model(&mut db, edit.clone(), None).unwrap();
        assert_eq!(secret_for_model(&db, &c.id).unwrap().1, "old");
        db.execute_batch("CREATE TRIGGER fail_keys BEFORE UPDATE ON ai_model_keys BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
        edit.display_name = "should rollback".into();
        let err = save_model(&mut db, edit.clone(), Some("replacement".into())).unwrap_err();
        assert!(!format!("{err:?}").contains("replacement"));
        assert_eq!(secret_for_model(&db, &c.id).unwrap().1, "old");
        assert_eq!(list_models(&db).unwrap()[0].display_name, "新名称");
        db.execute_batch("DROP TRIGGER fail_keys").unwrap();
        save_model(&mut db, edit, Some("new".into())).unwrap();
        assert_eq!(secret_for_model(&db, &c.id).unwrap().1, "new");
    }
    #[test]
    fn deletion_removes_key_and_defaults() {
        let mut db = setup();
        let c = save_model(&mut db, input(), Some("key".into())).unwrap();
        save_defaults(
            &db,
            &ModelDefaults {
                participant_ids: vec![c.id.clone()],
                summary_model_id: Some(c.id.clone()),
            },
        )
        .unwrap();
        delete_model(&mut db, &c.id).unwrap();
        assert_eq!(get_defaults(&db).unwrap(), ModelDefaults::default());
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM ai_model_keys", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn host_changes_and_enabled_models_require_explicit_key() {
        let mut db = setup();
        assert!(save_model(&mut db, input(), None).is_err());
        let c = save_model(&mut db, input(), Some("old".into())).unwrap();
        let mut edit = input();
        edit.id = Some(c.id.clone());
        edit.base_url = "https://other.example/v1".into();
        assert!(save_model(&mut db, edit.clone(), None).is_err());
        assert_eq!(
            list_models(&db).unwrap()[0].base_url,
            "https://example.com/v1"
        );
        save_model(&mut db, edit, Some("new-host-key".into())).unwrap();
        let mut draft = input();
        draft.enabled = false;
        let d = save_model(&mut db, draft.clone(), None).unwrap();
        draft.id = Some(d.id);
        draft.base_url = "https://draft.example/v1".into();
        save_model(&mut db, draft, None).unwrap();
    }
    #[test]
    fn migration_is_idempotent_and_unreadable_legacy_keys_remain_retryable() {
        let mut db = setup();
        let legacy = LegacySecrets::default();
        legacy.set("legacy-ref", "existing-key").unwrap();
        for (id, r) in [("one", "legacy-ref"), ("two", "missing-ref")] {
            let c = ModelConfig {
                id: id.into(),
                display_name: id.into(),
                provider: "custom".into(),
                base_url: "https://example.com/v1".into(),
                model: "test".into(),
                enabled: true,
            };
            db.execute(
                "INSERT INTO ai_models VALUES(?1,?2,?3)",
                params![id, encode(&c).unwrap(), r],
            )
            .unwrap();
        }
        assert_eq!(migrate_legacy_keys(&mut db, &legacy).unwrap(), 1);
        assert_eq!(secret_for_model(&db, "one").unwrap().1, "existing-key");
        assert_eq!(existing(&db, "one").unwrap().1, "");
        assert_eq!(existing(&db, "two").unwrap().1, "missing-ref");
        assert!(secret_for_model(&db, "two").is_err());
        assert_eq!(migrate_legacy_keys(&mut db, &legacy).unwrap(), 1);
        legacy.set("missing-ref", "recovered-key").unwrap();
        assert_eq!(migrate_legacy_keys(&mut db, &legacy).unwrap(), 0);
        assert_eq!(secret_for_model(&db, "two").unwrap().1, "recovered-key");
    }
    #[test]
    fn keys_survive_database_reopen() {
        let path =
            std::env::temp_dir().join(format!("tke-key-fixture-{}.sqlite3", uuid::Uuid::new_v4()));
        let mut db = crate::storage::connect(path.clone()).unwrap();
        let c = save_model(&mut db, input(), Some("persistent-fixture-key".into())).unwrap();
        drop(db);
        let db = crate::storage::connect(path.clone()).unwrap();
        assert_eq!(
            secret_for_model(&db, &c.id).unwrap().1,
            "persistent-fixture-key"
        );
        drop(db);
        std::fs::remove_file(path).unwrap();
    }
}
