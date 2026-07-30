use serde_json::Value as JsonValue;
use serde_yaml_ng::{Mapping, Sequence, Value};
use std::collections::HashSet;

const DEFAULT_DIRECT_POLICY: &str = "DIRECT";
const DEFAULT_REJECT_POLICY: &str = "REJECT";

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

fn build_custom_rules(settings: &JsonValue) -> Vec<String> {
    let mut rules = Vec::new();

    let Some(custom_rules) = settings.get("custom_rules").and_then(JsonValue::as_array) else {
        return rules;
    };

    for item in custom_rules {
        if !setting_bool(item, "enabled", true) {
            continue;
        }

        let Some(policy) = setting_str(item, "policy") else {
            continue;
        };
        let Some(value) = setting_str(item, "value") else {
            continue;
        };

        match setting_str(item, "type").unwrap_or("domain") {
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

fn build_smart_rules(config: &Mapping, settings: &JsonValue) -> Vec<String> {
    let proxy_policy = setting_str(settings, "proxy_policy")
        .map(ToOwned::to_owned)
        .or_else(|| first_proxy_group_name(config))
        .unwrap_or_else(|| DEFAULT_DIRECT_POLICY.to_owned());
    let direct_policy = setting_str(settings, "direct_policy").unwrap_or(DEFAULT_DIRECT_POLICY);
    let reject_policy = setting_str(settings, "reject_policy").unwrap_or(DEFAULT_REJECT_POLICY);

    let mut rules = Vec::new();
    rules.extend(build_custom_rules(settings));

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
        push_rule(&mut rules, format!("MATCH,{final_policy}"));
    }

    rules
}

pub fn apply_smart_routing(mut config: Mapping, smart_routing: Option<&JsonValue>) -> Mapping {
    let Some(settings) = smart_routing else {
        return config;
    };

    if !setting_bool(settings, "enabled", false) {
        return config;
    }

    let smart_rules = build_smart_rules(&config, settings);
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
        let result = apply_smart_routing(config.clone(), Some(&json!({ "enabled": false })));

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

        let result = apply_smart_routing(config, Some(&json!({ "enabled": true })));
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
}
