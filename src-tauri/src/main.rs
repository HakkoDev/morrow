// Hide the additional console window for installed Windows release builds.
// Debug builds retain console output for diagnostics.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    morrow_mail_lib::run();
}
