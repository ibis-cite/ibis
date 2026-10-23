//! Material policy is independent of a window so every fallback is testable.

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum Appearance {
    #[default]
    Opaque,
    #[cfg(any(target_os = "windows", test))]
    Mica,
    #[cfg(any(target_os = "macos", test))]
    Vibrancy,
    #[cfg(any(target_os = "macos", test))]
    LiquidGlass,
}

#[derive(Clone, Copy)]
pub(super) struct Preferences {
    pub(super) high_contrast: bool,
    pub(super) reduce_transparency: bool,
}

pub(super) fn requested(material: Appearance, preferences: Option<Preferences>) -> Appearance {
    match preferences {
        Some(Preferences {
            high_contrast: false,
            reduce_transparency: false,
        }) => material,
        _ => Appearance::Opaque,
    }
}

#[cfg(any(target_os = "macos", test))]
pub(super) enum GlassFailure {
    Unsupported,
    Failed,
}

/// An unsupported OS permits vibrancy; other failures must stay opaque.
#[cfg(any(target_os = "macos", test))]
pub(super) fn macos_material(
    glass: Result<(), GlassFailure>,
    vibrancy: impl FnOnce() -> Result<(), ()>,
) -> Result<Appearance, ()> {
    match glass {
        Ok(()) => Ok(Appearance::LiquidGlass),
        Err(GlassFailure::Unsupported) => vibrancy().map(|()| Appearance::Vibrancy),
        Err(GlassFailure::Failed) => Err(()),
    }
}

/// The evidence log accepts only native policy values, never an error payload.
pub(super) fn evidence_reason(
    material: Appearance,
    preferences: Option<Preferences>,
    transparent: bool,
    actual: Appearance,
) -> &'static str {
    if material == Appearance::Opaque {
        return "unsupported";
    }
    if !transparent {
        return "not-transparent";
    }
    let Some(preferences) = preferences else {
        return "unknown-preferences";
    };
    if preferences.high_contrast || preferences.reduce_transparency {
        return "accessibility";
    }
    #[cfg(any(target_os = "macos", test))]
    if material == Appearance::LiquidGlass && actual == Appearance::Vibrancy {
        return "unsupported-glass";
    }
    if actual != material {
        return "native-failure";
    }
    "applied"
}

impl Appearance {
    pub(super) fn name(self) -> &'static str {
        match self {
            Self::Opaque => "opaque",
            #[cfg(any(target_os = "windows", test))]
            Self::Mica => "mica",
            #[cfg(any(target_os = "macos", test))]
            Self::Vibrancy => "vibrancy",
            #[cfg(any(target_os = "macos", test))]
            Self::LiquidGlass => "liquid-glass",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_uses_glass_or_only_the_supported_vibrancy_fallback() {
        assert_eq!(
            macos_material(Ok(()), || panic!("glass needs no fallback")),
            Ok(Appearance::LiquidGlass)
        );
        assert_eq!(
            macos_material(Err(GlassFailure::Unsupported), || Ok(())),
            Ok(Appearance::Vibrancy)
        );
        assert_eq!(macos_material(Err(GlassFailure::Unsupported), || Err(())), Err(()));
        assert_eq!(
            macos_material(Err(GlassFailure::Failed), || panic!(
                "native failures must not try fallback"
            )),
            Err(())
        );
        let normal = Some(Preferences {
            high_contrast: false,
            reduce_transparency: false,
        });
        assert_eq!(
            evidence_reason(Appearance::LiquidGlass, normal, true, Appearance::LiquidGlass),
            "applied"
        );
        assert_eq!(
            evidence_reason(Appearance::LiquidGlass, normal, true, Appearance::Vibrancy),
            "unsupported-glass"
        );
        assert_eq!(
            evidence_reason(Appearance::LiquidGlass, normal, true, Appearance::Opaque),
            "native-failure"
        );
    }

    #[test]
    fn evidence_distinguishes_native_success_from_every_opaque_fallback() {
        let normal = Some(Preferences {
            high_contrast: false,
            reduce_transparency: false,
        });
        let accessible = Some(Preferences {
            high_contrast: false,
            reduce_transparency: true,
        });
        assert_eq!(
            evidence_reason(Appearance::Opaque, None, false, Appearance::Opaque),
            "unsupported"
        );
        assert_eq!(
            evidence_reason(Appearance::Mica, normal, false, Appearance::Opaque),
            "not-transparent"
        );
        assert_eq!(
            evidence_reason(Appearance::Mica, None, true, Appearance::Opaque),
            "unknown-preferences"
        );
        assert_eq!(
            evidence_reason(Appearance::Vibrancy, accessible, true, Appearance::Opaque),
            "accessibility"
        );
        assert_eq!(
            evidence_reason(Appearance::Mica, normal, true, Appearance::Opaque),
            "native-failure"
        );
        assert_eq!(
            evidence_reason(Appearance::Vibrancy, normal, true, Appearance::Vibrancy),
            "applied"
        );
    }

    #[test]
    fn unknown_preferences_are_opaque_on_every_platform() {
        for material in [
            Appearance::Opaque,
            Appearance::Mica,
            Appearance::Vibrancy,
            Appearance::LiquidGlass,
        ] {
            assert_eq!(requested(material, None), Appearance::Opaque);
        }
    }

    #[test]
    fn either_accessibility_preference_requires_opacity() {
        for material in [Appearance::Mica, Appearance::Vibrancy, Appearance::LiquidGlass] {
            for (high_contrast, reduce_transparency) in [(true, false), (false, true), (true, true)] {
                assert_eq!(
                    requested(
                        material,
                        Some(Preferences {
                            high_contrast,
                            reduce_transparency
                        })
                    ),
                    Appearance::Opaque
                );
            }
        }
    }

    #[test]
    fn only_supported_materials_and_explicit_preferences_allow_effects() {
        let preferences = || {
            Some(Preferences {
                high_contrast: false,
                reduce_transparency: false,
            })
        };
        assert_eq!(requested(Appearance::Opaque, preferences()), Appearance::Opaque);
        assert_eq!(requested(Appearance::Mica, preferences()), Appearance::Mica);
        assert_eq!(requested(Appearance::Vibrancy, preferences()), Appearance::Vibrancy);
    }

    #[test]
    fn native_material_names_are_fixed() {
        assert_eq!(Appearance::Opaque.name(), "opaque");
        assert_eq!(Appearance::Mica.name(), "mica");
        assert_eq!(Appearance::Vibrancy.name(), "vibrancy");
        assert_eq!(Appearance::LiquidGlass.name(), "liquid-glass");
    }
}
