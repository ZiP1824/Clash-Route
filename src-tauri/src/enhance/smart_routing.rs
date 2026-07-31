use serde_json::Value as JsonValue;
use serde_yaml_ng::{Mapping, Sequence, Value};
use std::collections::{HashMap, HashSet};

const DEFAULT_DIRECT_POLICY: &str = "DIRECT";
const DEFAULT_REJECT_POLICY: &str = "REJECT";
const BUILTIN_POLICIES: &[&str] = &["DIRECT", "REJECT", "REJECT-DROP", "PASS"];

pub type ProxyLibrary = HashMap<String, Mapping>;

fn setting_bool(settings: &JsonValue, key: &str, default: bool) -> bool {
    settings.get(key).and_then(JsonValue::as_bool).unwrap_or(default)
}

fn setting_str<'a>(settings: &'a JsonValue, key: &str) -> Option<&'a str> {
    settings
        .get(key)
        .and_then(JsonValue::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn category_enabled(settings: &JsonValue, key: &str, default: bool) -> bool {
    settings
        .get("categories")
        .and_then(|value| value.get(key))
        .and_then(JsonValue::as_bool)
        .unwrap_or(default)
}

fn first_proxy_group_name(config: &Mapping) -> Option<String> {
    config
        .get("proxy-groups")
        .and_then(Value::as_sequence)
        .and_then(|groups| {
            groups.iter().find_map(|group| {
                group
                    .as_mapping()
                    .and_then(|group| group.get("name"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
        })
}

fn existing_rule_strings(rules: &Sequence) -> HashSet<String> {
    rules.iter().filter_map(Value::as_str).map(ToOwned::to_owned).collect()
}

fn push_rule(rules: &mut Vec<String>, rule: impl Into<String>) {
    let rule = rule.into();
    if !rules.iter().any(|item| item == &rule) {
        rules.push(rule);
    }
}

fn proxy_exists(config: &Mapping, proxy_name: &str) -> bool {
    config
        .get("proxies")
        .and_then(Value::as_sequence)
        .map(|proxies| {
            proxies.iter().any(|proxy| {
                proxy
                    .as_mapping()
                    .and_then(|proxy| proxy.get("name"))
                    .and_then(Value::as_str)
                    == Some(proxy_name)
            })
        })
        .unwrap_or(false)
}

fn proxy_group_exists(config: &Mapping, proxy_name: &str) -> bool {
    config
        .get("proxy-groups")
        .and_then(Value::as_sequence)
        .map(|groups| {
            groups.iter().any(|group| {
                group
                    .as_mapping()
                    .and_then(|group| group.get("name"))
                    .and_then(Value::as_str)
                    == Some(proxy_name)
            })
        })
        .unwrap_or(false)
}

fn proxy_provider_exists(config: &Mapping, proxy_name: &str) -> bool {
    config
        .get("proxy-providers")
        .and_then(Value::as_mapping)
        .map(|providers| providers.keys().any(|key| key.as_str() == Some(proxy_name)))
        .unwrap_or(false)
}

fn policy_exists(config: &Mapping, policy: &str) -> bool {
    BUILTIN_POLICIES.contains(&policy)
        || proxy_exists(config, policy)
        || proxy_group_exists(config, policy)
        || proxy_provider_exists(config, policy)
}

fn append_proxy(config: &mut Mapping, name: &str, proxy: Mapping) -> bool {
    if proxy_exists(config, name) {
        return true;
    }

    let proxies_key = Value::from("proxies");
    if !matches!(config.get(&proxies_key), Some(Value::Sequence(_))) {
        config.insert(proxies_key.clone(), Value::Sequence(Sequence::new()));
    }

    let Some(Value::Sequence(proxies)) = config.get_mut(&proxies_key) else {
        return false;
    };

    let mut proxy = proxy;
    proxy.insert(Value::from("name"), Value::from(name));
    proxies.push(Value::Mapping(proxy));
    true
}

fn ensure_policy_available(config: &mut Mapping, policy: &str, proxy_library: &ProxyLibrary) -> bool {
    if policy_exists(config, policy) {
        return true;
    }

    proxy_library
        .get(policy)
        .cloned()
        .is_some_and(|proxy| append_proxy(config, policy, proxy))
}

fn chain_proxy_name(index: usize, rule_type: &str, value: &str) -> String {
    let slug = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .take(4)
        .collect::<Vec<_>>()
        .join("-");

    format!(
        "RouteChain-{}-{}-{}",
        index + 1,
        rule_type,
        if slug.is_empty() { "rule" } else { slug.as_str() }
    )
}

fn push_chain_proxy(
    config: &mut Mapping,
    name: &str,
    entry_proxy: &str,
    exit_proxy: &str,
    proxy_library: &ProxyLibrary,
) -> bool {
    if entry_proxy == exit_proxy
        || !ensure_policy_available(config, entry_proxy, proxy_library)
        || !ensure_policy_available(config, exit_proxy, proxy_library)
    {
        return false;
    }

    let Some(Value::Sequence(proxies)) = config.get_mut("proxies") else {
        return false;
    };

    if proxies.iter().any(|proxy| {
        proxy
            .as_mapping()
            .and_then(|proxy| proxy.get("name"))
            .and_then(Value::as_str)
            == Some(name)
    }) {
        return true;
    }

    let Some(exit_proxy_config) = proxies
        .iter()
        .find(|proxy| {
            proxy
                .as_mapping()
                .and_then(|proxy| proxy.get("name"))
                .and_then(Value::as_str)
                == Some(exit_proxy)
        })
        .and_then(Value::as_mapping)
        .cloned()
    else {
        return false;
    };

    let mut chained_proxy = exit_proxy_config;
    chained_proxy.insert(Value::from("name"), Value::from(name));
    chained_proxy.insert(Value::from("dialer-proxy"), Value::from(entry_proxy));
    proxies.push(Value::Mapping(chained_proxy));
    true
}

fn normalize_domain(value: &str) -> Option<String> {
    let value = value
        .trim()
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .trim_start_matches('.');
    let domain = value.split('/').next().unwrap_or(value).trim();

    if domain.is_empty() {
        None
    } else {
        Some(domain.to_owned())
    }
}

fn normalize_process_name(value: &str) -> Option<String> {
    let value = value.trim().trim_matches('"').trim_matches('\'');
    let name = value.rsplit(['\\', '/']).next().unwrap_or(value).trim();

    if name.is_empty() { None } else { Some(name.to_owned()) }
}

fn build_custom_rules(config: &mut Mapping, settings: &JsonValue, proxy_library: &ProxyLibrary) -> Vec<String> {
    let mut rules = Vec::new();

    let Some(custom_rules) = settings.get("custom_rules").and_then(JsonValue::as_array) else {
        return rules;
    };

    for (index, item) in custom_rules.iter().enumerate() {
        if !setting_bool(item, "enabled", true) {
            continue;
        }

        let Some(policy) = setting_str(item, "policy") else {
            continue;
        };
        let Some(value) = setting_str(item, "value") else {
            continue;
        };

        let rule_type = setting_str(item, "type").unwrap_or("domain");
        let policy = if setting_bool(item, "chain_enabled", false) {
            let chain_entry = setting_str(item, "chain_entry");
            let chain_exit = setting_str(item, "chain_exit");
            if let (Some(chain_entry), Some(chain_exit)) = (chain_entry, chain_exit) {
                let chain_name = chain_proxy_name(index, rule_type, value);
                if push_chain_proxy(config, &chain_name, chain_entry, chain_exit, proxy_library) {
                    chain_name
                } else {
                    policy.to_owned()
                }
            } else {
                policy.to_owned()
            }
        } else {
            policy.to_owned()
        };

        if !ensure_policy_available(config, &policy, proxy_library) {
            continue;
        }

        match rule_type {
            "process" => {
                if let Some(process) = normalize_process_name(value) {
                    push_rule(&mut rules, format!("PROCESS-NAME,{process},{policy}"));
                }
            }
            _ => {
                if let Some(domain) = normalize_domain(value) {
                    push_rule(&mut rules, format!("DOMAIN-SUFFIX,{domain},{policy}"));
                }
            }
        }
    }

    rules
}

fn build_smart_rules(config: &mut Mapping, settings: &JsonValue, proxy_library: &ProxyLibrary) -> Vec<String> {
    let mut proxy_policy = setting_str(settings, "proxy_policy")
        .map(ToOwned::to_owned)
        .or_else(|| first_proxy_group_name(config))
        .unwrap_or_else(|| DEFAULT_DIRECT_POLICY.to_owned());
    let direct_policy = setting_str(settings, "direct_policy").unwrap_or(DEFAULT_DIRECT_POLICY);
    let reject_policy = setting_str(settings, "reject_policy").unwrap_or(DEFAULT_REJECT_POLICY);

    let mut rules = Vec::new();
    if !ensure_policy_available(config, &proxy_policy, proxy_library) {
        proxy_policy = first_proxy_group_name(config).unwrap_or_else(|| DEFAULT_DIRECT_POLICY.to_owned());
    }
    rules.extend(build_custom_rules(config, settings, proxy_library));

    if category_enabled(settings, "ads", true) {
        push_rule(&mut rules, format!("GEOSITE,category-ads-all,{reject_policy}"));
    }

    if category_enabled(settings, "lan", true) {
        push_rule(&mut rules, format!("IP-CIDR,10.0.0.0/8,{direct_policy},no-resolve"));
        push_rule(&mut rules, format!("IP-CIDR,172.16.0.0/12,{direct_policy},no-resolve"));
        push_rule(&mut rules, format!("IP-CIDR,192.168.0.0/16,{direct_policy},no-resolve"));
        push_rule(&mut rules, format!("IP-CIDR,127.0.0.0/8,{direct_policy},no-resolve"));
        push_rule(&mut rules, format!("IP-CIDR6,fc00::/7,{direct_policy},no-resolve"));
        push_rule(&mut rules, format!("IP-CIDR6,fe80::/10,{direct_policy},no-resolve"));
    }

    if category_enabled(settings, "domestic", true) {
        push_rule(&mut rules, format!("GEOSITE,private,{direct_policy}"));
        push_rule(&mut rules, format!("GEOSITE,cn,{direct_policy}"));
        push_rule(&mut rules, format!("GEOIP,CN,{direct_policy},no-resolve"));
    }

    if category_enabled(settings, "ai", true) {
        for domain in [
            "openai.com",
            "chatgpt.com",
            "anthropic.com",
            "claude.ai",
            "gemini.google.com",
            "perplexity.ai",
        ] {
            push_rule(&mut rules, format!("DOMAIN-SUFFIX,{domain},{proxy_policy}"));
        }
    }

    if category_enabled(settings, "streaming", true) {
        for domain in [
            "youtube.com",
            "googlevideo.com",
            "netflix.com",
            "nflxvideo.net",
            "disneyplus.com",
        ] {
            push_rule(&mut rules, format!("DOMAIN-SUFFIX,{domain},{proxy_policy}"));
        }
    }

    if category_enabled(settings, "foreign", true) {
        push_rule(&mut rules, format!("GEOSITE,geolocation-!cn,{proxy_policy}"));
    }

    if setting_bool(settings, "append_match", false) {
        let final_policy = setting_str(settings, "final_policy").unwrap_or(&proxy_policy);
        if ensure_policy_available(config, final_policy, proxy_library) {
            push_rule(&mut rules, format!("MATCH,{final_policy}"));
        }
    }

    rules
}

pub fn apply_smart_routing(
    mut config: Mapping,
    smart_routing: Option<&JsonValue>,
    proxy_library: &ProxyLibrary,
) -> Mapping {
    let Some(settings) = smart_routing else {
        return config;
    };

    if !setting_bool(settings, "enabled", false) {
        return config;
    }

    let smart_rules = build_smart_rules(&mut config, settings, proxy_library);
    if smart_rules.is_empty() {
        return config;
    }

    let rules_key = Value::from("rules");
    let mut existing_rules = config
        .remove(&rules_key)
        .and_then(|value| value.as_sequence().cloned())
        .unwrap_or_default();

    let mut seen = existing_rule_strings(&existing_rules);
    let mut next_rules = Sequence::new();

    for rule in smart_rules {
        if seen.insert(rule.clone()) {
            next_rules.push(Value::from(rule));
        }
    }

    next_rules.append(&mut existing_rules);
    config.insert(rules_key, Value::Sequence(next_rules));
    config
}

#[cfg(test)]
mod tests {
    use super::apply_smart_routing;
    use serde_json::json;
    use serde_yaml_ng::{Mapping, Value};

    fn mapping(yaml: &str) -> Mapping {
        serde_yaml_ng::from_str(yaml).expect("test yaml should parse")
    }

    #[test]
    fn disabled_config_keeps_rules_unchanged() {
        let config = mapping(r#"rules: ["DOMAIN-SUFFIX,example.com,DIRECT"]"#);
        let result = apply_smart_routing(config.clone(), Some(&json!({ "enabled": false })), &Default::default());

        assert_eq!(result.get("rules"), config.get("rules"));
    }

    #[test]
    fn enabled_config_prepends_smart_rules() {
        let config = mapping(
            r#"
proxy-groups:
  - name: Proxy
    type: select
rules:
  - DOMAIN-SUFFIX,example.com,DIRECT
"#,
        );

        let result = apply_smart_routing(config, Some(&json!({ "enabled": true })), &Default::default());
        let rules = result
            .get("rules")
            .and_then(Value::as_sequence)
            .expect("rules should be a sequence");

        assert_eq!(
            rules.first().and_then(Value::as_str),
            Some("GEOSITE,category-ads-all,REJECT")
        );
        assert!(
            rules
                .iter()
                .any(|rule| rule.as_str() == Some("GEOSITE,geolocation-!cn,Proxy"))
        );
        assert!(
            rules
                .iter()
                .any(|rule| rule.as_str() == Some("DOMAIN-SUFFIX,example.com,DIRECT"))
        );
    }

    #[test]
    fn custom_rules_take_priority() {
        let config = mapping(
            r#"
proxy-groups:
  - name: Proxy
    type: select
rules:
  - MATCH,DIRECT
"#,
        );

        let result = apply_smart_routing(
            config,
            Some(&json!({
                "enabled": true,
                "custom_rules": [
                    { "enabled": true, "type": "domain", "value": "https://example.com/path", "policy": "Proxy" },
                    { "enabled": true, "type": "process", "value": "C:\\Program Files\\Steam\\steam.exe", "policy": "DIRECT" }
                ]
            })),
            &Default::default(),
        );
        let rules = result
            .get("rules")
            .and_then(Value::as_sequence)
            .expect("rules should be a sequence");

        assert_eq!(
            rules.first().and_then(Value::as_str),
            Some("DOMAIN-SUFFIX,example.com,Proxy")
        );
        assert_eq!(
            rules.get(1).and_then(Value::as_str),
            Some("PROCESS-NAME,steam.exe,DIRECT")
        );
    }

    #[test]
    fn chained_custom_rule_generates_dialer_proxy() {
        let config = mapping(
            r#"
proxies:
  - name: JP-1
    type: ss
    server: jp.example.com
    port: 443
    cipher: aes-128-gcm
    password: pass
  - name: TW-1
    type: ss
    server: tw.example.com
    port: 443
    cipher: aes-128-gcm
    password: pass
rules:
  - MATCH,DIRECT
"#,
        );

        let result = apply_smart_routing(
            config,
            Some(&json!({
                "enabled": true,
                "custom_rules": [
                    {
                        "enabled": true,
                        "type": "domain",
                        "value": "youtube.com",
                        "policy": "TW-1",
                        "chain_enabled": true,
                        "chain_entry": "JP-1",
                        "chain_exit": "TW-1"
                    }
                ],
                "categories": {
                    "ads": false,
                    "lan": false,
                    "domestic": false,
                    "foreign": false,
                    "ai": false,
                    "streaming": false
                }
            })),
            &Default::default(),
        );

        let rules = result
            .get("rules")
            .and_then(Value::as_sequence)
            .expect("rules should be a sequence");
        assert_eq!(
            rules.first().and_then(Value::as_str),
            Some("DOMAIN-SUFFIX,youtube.com,RouteChain-1-domain-youtube-com")
        );

        let chained_proxy = result
            .get("proxies")
            .and_then(Value::as_sequence)
            .and_then(|proxies| {
                proxies
                    .iter()
                    .find(|proxy| proxy.get("name").and_then(Value::as_str) == Some("RouteChain-1-domain-youtube-com"))
            })
            .and_then(Value::as_mapping)
            .expect("chain proxy should be generated");

        assert_eq!(chained_proxy.get("dialer-proxy").and_then(Value::as_str), Some("JP-1"));
    }

    #[test]
    fn custom_rule_can_use_proxy_from_library() {
        let config = mapping(
            r#"
proxies: []
rules:
  - MATCH,DIRECT
"#,
        );
        let mut library = super::ProxyLibrary::new();
        library.insert(
            "TW-3".to_owned(),
            mapping(
                r#"
name: TW-3
type: ss
server: tw.example.com
port: 443
cipher: aes-128-gcm
password: pass
"#,
            ),
        );

        let result = apply_smart_routing(
            config,
            Some(&json!({
                "enabled": true,
                "custom_rules": [
                    { "enabled": true, "type": "domain", "value": "youtube.com", "policy": "TW-3" }
                ],
                "categories": {
                    "ads": false,
                    "lan": false,
                    "domestic": false,
                    "foreign": false,
                    "ai": false,
                    "streaming": false
                }
            })),
            &library,
        );

        let rules = result
            .get("rules")
            .and_then(Value::as_sequence)
            .expect("rules should be a sequence");
        assert_eq!(
            rules.first().and_then(Value::as_str),
            Some("DOMAIN-SUFFIX,youtube.com,TW-3")
        );
        assert!(
            result
                .get("proxies")
                .and_then(Value::as_sequence)
                .is_some_and(|proxies| proxies
                    .iter()
                    .any(|proxy| proxy.get("name").and_then(Value::as_str) == Some("TW-3")))
        );
    }
}
