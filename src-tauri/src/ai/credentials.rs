use super::types::*;
pub trait SecretStore: Send + Sync {
    fn set(&self, reference: &str, secret: &str) -> AiResult<()>;
    fn get(&self, reference: &str) -> AiResult<String>;
    fn delete(&self, reference: &str) -> AiResult<()>;
}
pub struct SystemSecrets {
    service: String,
}
impl SystemSecrets {
    pub fn new(qa: bool) -> Self {
        Self {
            service: if qa {
                "com.stev.tcalculator.ai.qa"
            } else {
                "com.stev.tcalculator.ai"
            }
            .into(),
        }
    }
    fn entry(&self, r: &str) -> AiResult<keyring::Entry> {
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = r;
            return Err(AiError::new(
                "unsupportedSecretStore",
                "当前平台没有配置系统安全存储",
            ));
        }
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        keyring::Entry::new(&self.service, r)
            .map_err(|_| AiError::new("secretStore", "无法访问系统安全存储"))
    }
}
impl SecretStore for SystemSecrets {
    fn set(&self, r: &str, s: &str) -> AiResult<()> {
        self.entry(r)?
            .set_password(s)
            .map_err(|_| AiError::new("secretStore", "密钥未保存；请检查系统安全存储权限"))
    }
    fn get(&self, r: &str) -> AiResult<String> {
        self.entry(r)?.get_password().map_err(|_| {
            AiError::new(
                "missingSecret",
                "无法读取密钥；请重新配置或检查系统安全存储权限",
            )
        })
    }
    fn delete(&self, r: &str) -> AiResult<()> {
        match self.entry(r)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(AiError::new("secretStore", "系统凭证清理失败")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "writes and deletes one isolated disposable QA credential"]
    fn system_keychain_round_trip_qa() {
        let store = SystemSecrets::new(true);
        let reference = format!("qa-test-{}", uuid::Uuid::new_v4());
        store.set(&reference, "disposable-ai-storage-test").unwrap();
        let read = store.get(&reference);
        let removed = store.delete(&reference);
        assert_eq!(read.unwrap(), "disposable-ai-storage-test");
        removed.unwrap();
        assert!(store.get(&reference).is_err());
    }
}
