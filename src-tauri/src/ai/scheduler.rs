use super::types::*;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;
pub struct Scheduler {
    global: Arc<Semaphore>,
    origins: Mutex<HashMap<String, Arc<Semaphore>>>,
}
pub struct Permit {
    _global: OwnedSemaphorePermit,
    _origin: OwnedSemaphorePermit,
}
impl Scheduler {
    pub fn new() -> Self {
        Self {
            global: Arc::new(Semaphore::new(3)),
            origins: Mutex::new(HashMap::new()),
        }
    }
    pub async fn acquire(&self, origin: &str, cancel: &CancellationToken) -> AiResult<Permit> {
        let cancelled = || AiError::new("cancelled", "分析已取消");
        if cancel.is_cancelled() {
            return Err(cancelled());
        }
        let local = {
            self.origins
                .lock()
                .map_err(|_| AiError::new("queue", "模型队列不可用"))?
                .entry(origin.into())
                .or_insert_with(|| Arc::new(Semaphore::new(2)))
                .clone()
        };
        let origin_permit = tokio::select! {biased;_ = cancel.cancelled()=>return Err(cancelled()),p=local.acquire_owned()=>p.map_err(|_|cancelled())?};
        let global_permit = tokio::select! {biased;_=cancel.cancelled()=>return Err(cancelled()),p=self.global.clone().acquire_owned()=>p.map_err(|_|cancelled())?};
        Ok(Permit {
            _global: global_permit,
            _origin: origin_permit,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    #[tokio::test]
    async fn limits_global_3_origin_2() {
        let s = Scheduler::new();
        let c = CancellationToken::new();
        let a = s.acquire("https://a.test", &c).await;
        assert!(a.is_ok());
        let a = a.unwrap();
        let b = s.acquire("https://a.test", &c).await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(20), s.acquire("https://a.test", &c))
                .await
                .is_err()
        );
        let d = s.acquire("https://b.test", &c).await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(20), s.acquire("https://c.test", &c))
                .await
                .is_err()
        );
        drop(a);
        assert!(s.acquire("https://c.test", &c).await.is_ok());
        drop((b, d));
    }
    #[tokio::test]
    async fn waiting_cancel_releases_any_acquired_permit() {
        let s = Scheduler::new();
        let c = CancellationToken::new();
        let a = s.acquire("a", &c).await.unwrap();
        let b = s.acquire("a", &c).await.unwrap();
        let cancelled = CancellationToken::new();
        cancelled.cancel();
        assert_eq!(
            s.acquire("a", &cancelled).await.err().unwrap().code,
            "cancelled"
        );
        drop((a, b));
        assert!(s.acquire("b", &c).await.is_ok());
    }
}
