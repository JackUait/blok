//! A second SIGTERM or SIGINT during a held stop ends the process at once,
//! by that signal, as Node's does. tokio keeps its handler for the life of
//! the process, so the default action is put back and the signal raised.
// Unsafe code: libc's signal and raise have no safe wrapper in the deps.
#![allow(unsafe_code)]

/// Which stop signal came.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stop {
    // Only Unix has SIGTERM.
    #[cfg_attr(not(unix), allow(dead_code))]
    Terminate,
    Interrupt,
}

/// Ends the process by `stop`'s signal. Never returns.
pub fn die_by(stop: Stop) -> ! {
    #[cfg(unix)]
    {
        let number = match stop {
            Stop::Terminate => libc::SIGTERM,
            Stop::Interrupt => libc::SIGINT,
        };
        // SAFETY: SIG_DFL is a valid disposition and raise only sends a signal.
        unsafe {
            libc::signal(number, libc::SIG_DFL);
            libc::raise(number);
        }
        std::process::exit(128 + number);
    }
    #[cfg(not(unix))]
    {
        let _ = stop;
        std::process::exit(1);
    }
}
