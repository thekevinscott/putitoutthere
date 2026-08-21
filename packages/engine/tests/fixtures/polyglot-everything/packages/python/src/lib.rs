use pyo3::prelude::*;

/// Re-exposes the embedded core crate's `CARGO_PKG_VERSION` as a module
/// attribute, so a test can build the real wheel and read back what the
/// compiler actually baked into the crate the wheel embeds — not what a
/// manifest claims. Left stale, this is the value that reports the wrong
/// release (#374, #621). #641.
#[pymodule]
fn piot_fixture_zzz_python(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add("core_version", piot_fixture_zzz_poly_core::version())?;
    Ok(())
}
