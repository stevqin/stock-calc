use std::sync::{Arc, Mutex};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
pub async fn serve(
    responses: Vec<(u16, String)>,
) -> (String, Arc<Mutex<Vec<String>>>, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}/v1", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let copy = seen.clone();
    let handle = tokio::spawn(async move {
        for (status, body) in responses {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut all = Vec::new();
            loop {
                let mut chunk = [0u8; 4096];
                let n = socket.read(&mut chunk).await.unwrap();
                if n == 0 {
                    break;
                }
                all.extend_from_slice(&chunk[..n]);
                let s = String::from_utf8_lossy(&all);
                if let Some(i) = s.find("\r\n\r\n") {
                    let length = s[..i]
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length: ")
                                .and_then(|s| s.parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if all.len() >= i + 4 + length {
                        break;
                    }
                }
            }
            copy.lock()
                .unwrap()
                .push(String::from_utf8_lossy(&all).into());
            let headers = if status == 302 {
                "Location: https://other.example/\r\n"
            } else {
                ""
            };
            let response=format!("HTTP/1.1 {status} Test\r\n{headers}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
            let _ = socket.write_all(response.as_bytes()).await;
        }
    });
    (address, seen, handle)
}
