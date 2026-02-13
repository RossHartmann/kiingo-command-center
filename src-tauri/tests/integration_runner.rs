use std::path::PathBuf;
#[cfg(unix)]
use std::process::Command;

#[test]
fn fixture_scripts_exist() {
    let codex = PathBuf::from("tests/fixtures/mock-codex.sh");
    let claude = PathBuf::from("tests/fixtures/mock-claude.sh");
    assert!(codex.exists());
    assert!(claude.exists());
}

#[cfg(unix)]
#[test]
fn fixture_scripts_report_expected_versions() {
    let codex = Command::new("bash")
        .arg("tests/fixtures/mock-codex.sh")
        .arg("--version")
        .output()
        .expect("run codex fixture");
    assert!(codex.status.success());
    assert_eq!(String::from_utf8_lossy(&codex.stdout).trim(), "codex 0.27.0");

    let claude = Command::new("bash")
        .arg("tests/fixtures/mock-claude.sh")
        .arg("--version")
        .output()
        .expect("run claude fixture");
    assert!(claude.status.success());
    assert_eq!(String::from_utf8_lossy(&claude.stdout).trim(), "claude 0.31.1");
}

#[cfg(unix)]
#[test]
fn fixture_scripts_emit_expected_noninteractive_shapes() {
    let codex = Command::new("bash")
        .arg("tests/fixtures/mock-codex.sh")
        .output()
        .expect("run codex fixture");
    assert!(codex.status.success());
    assert!(String::from_utf8_lossy(&codex.stderr).contains("progress:"));
    assert!(String::from_utf8_lossy(&codex.stdout).contains("final result from codex"));

    let claude = Command::new("bash")
        .arg("tests/fixtures/mock-claude.sh")
        .output()
        .expect("run claude fixture");
    assert!(claude.status.success());
    let out = String::from_utf8_lossy(&claude.stdout);
    assert!(out.contains("\"type\":\"progress\""));
    assert!(out.contains("\"type\":\"final\""));
}
