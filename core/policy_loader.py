"""
Compliance Policy Loader Module

Loads and manages compliance policy documents for grounded video analysis.
Policies are passed to Gemini during analysis to ensure factual, consistent compliance checking.
"""

import json
import logging
from pathlib import Path
from typing import Dict, Optional, Any

logger = logging.getLogger(__name__)

# Path to compliance policies directory
POLICIES_DIR = Path(__file__).parent / "compliance_policies"

# Cache for loaded policies
_policy_cache: Dict[str, dict] = {}


def get_policy_key(platform: str, region: str) -> str:
    """Generate a standardized key for policy lookup."""
    # Normalize inputs
    platform_clean = platform.lower().replace(" ", "_")
    region_clean = region.lower().replace(" ", "_")
    return f"{platform_clean}_{region_clean}"


def load_policy(platform: str, region: str) -> Optional[dict]:
    """
    Load a compliance policy document for the given platform and region.
    
    Args:
        platform: e.g., "YouTube", "TikTok", "Netflix"
        region: e.g., "United States", "Middle East", "Europe"
        
    Returns:
        Policy document as dict, or None if not found
    """
    key = get_policy_key(platform, region)
    
    # Check cache first
    if key in _policy_cache:
        logger.debug(f"Using cached policy: {key}")
        return _policy_cache[key]
    
    # Try to load from file
    policy_file = POLICIES_DIR / f"{key}.json"
    
    if not policy_file.exists():
        logger.warning(f"No policy found for {platform}/{region}, falling back to default")
        # Try US as fallback
        fallback_key = get_policy_key(platform, "United States")
        policy_file = POLICIES_DIR / f"{fallback_key}.json"
        
        if not policy_file.exists():
            logger.error(f"No policy found for {platform}, no analysis guidance available")
            return None
    
    try:
        with open(policy_file, "r", encoding="utf-8") as f:
            policy = json.load(f)
            _policy_cache[key] = policy
            logger.info(f"Loaded compliance policy: {policy_file.name}")
            return policy
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse policy file {policy_file}: {e}")
        return None
    except Exception as e:
        logger.error(f"Failed to load policy file {policy_file}: {e}")
        return None


def get_policy_for_rating(policy: dict, rating: str) -> dict:
    """
    Extract the specific rating rules from a policy.
    
    Args:
        policy: Full policy document
        rating: e.g., "Kids (G)", "Teens (PG-13)", "Adult (R)"
        
    Returns:
        Rating-specific rules
    """
    ratings = policy.get("ratings", {})
    
    if rating in ratings:
        return ratings[rating]
    
    # Try to match partial rating
    for key in ratings:
        if rating.lower() in key.lower():
            return ratings[key]
    
    # Return most restrictive (Kids) if not found
    logger.warning(f"Rating '{rating}' not found, using most restrictive")
    return ratings.get("Kids (G)", {})


def format_policy_for_prompt(platform: str, region: str, rating: str) -> str:
    """
    Format compliance policy as text for insertion into Gemini prompt.
    
    Returns a formatted string with all relevant rules for the given context.
    """
    policy = load_policy(platform, region)
    
    if not policy:
        # Try global fallback
        global_policy = POLICIES_DIR / "global.json"
        if global_policy.exists():
            try:
                with open(global_policy, "r", encoding="utf-8") as f:
                    policy = json.load(f)
                    logger.info("Using global fallback policy")
            except Exception:
                pass
    
    if not policy:
        return """
## GENERAL COMPLIANCE GUIDELINES
No specific compliance policy found. Use general content moderation guidelines:
- Flag violence, profanity, alcohol, tobacco, drugs, sexual content
- Consider audience age appropriateness
- Note any potentially controversial content
"""
    
    # Get rating rules (handle both "rating_rules" and "ratings" keys)
    rating_rules_container = policy.get("rating_rules", policy.get("ratings", {}))
    rating_rules = rating_rules_container.get(rating, {})
    
    # If rating not found, try partial match
    if not rating_rules:
        for key in rating_rules_container:
            if rating.lower() in key.lower() or key.lower() in rating.lower():
                rating_rules = rating_rules_container[key]
                break
    
    # Get content categories (handle both key names)
    content_categories = policy.get("content_category_definitions", 
                                    policy.get("content_categories", {}))
    platform_rules = policy.get("platform_specific_rules", {})
    regional_notes = policy.get("regional_notes", {})
    
    # Build prompt section
    lines = [
        f"## COMPLIANCE POLICY: {policy.get('platform', platform)} / {policy.get('region', region)} / {rating}",
        f"Policy: {policy.get('policy_name', 'Platform Guidelines')}",
        "",
    ]
    
    # Add regional overview if available
    if regional_notes.get("overview"):
        lines.extend([
            "### REGIONAL CONTEXT:",
            regional_notes["overview"],
            ""
        ])
    
    # Add prohibited content
    lines.append("### PROHIBITED CONTENT (Flag as CRITICAL):")
    for item in rating_rules.get("prohibited", []):
        lines.append(f"- {item}")
    
    # Add restricted content
    lines.extend([
        "",
        "### RESTRICTED CONTENT (Flag as WARNING):"
    ])
    for item in rating_rules.get("restricted", []):
        lines.append(f"- {item}")
    
    # Add general requirements
    if rating_rules.get("general_requirements"):
        lines.extend([
            "",
            "### GENERAL REQUIREMENTS:"
        ])
        for item in rating_rules.get("general_requirements", []):
            lines.append(f"- {item}")
    
    # Add content category details with severity
    lines.extend([
        "",
        "### CONTENT DETECTION GUIDELINES:"
    ])
    
    for category, details in content_categories.items():
        severity = details.get("severity", "warning")
        notes = details.get("notes", "")
        keywords = details.get("keywords", [])
        
        lines.append(f"- **{category.upper()}** [Severity: {severity}]")
        if notes:
            lines.append(f"  Note: {notes}")
        if keywords:
            lines.append(f"  Keywords: {', '.join(keywords[:10])}")  # Limit keywords
    
    # Add platform rules (if dict format, extract key points)
    if platform_rules:
        lines.extend([
            "",
            "### PLATFORM-SPECIFIC RULES:"
        ])
        if isinstance(platform_rules, dict):
            for key, value in list(platform_rules.items())[:5]:
                lines.append(f"- **{key}**: {value}")
        elif isinstance(platform_rules, list):
            for rule in platform_rules[:5]:
                lines.append(f"- {rule}")
    
    return "\n".join(lines)


def list_available_policies() -> list:
    """List all available policy files."""
    if not POLICIES_DIR.exists():
        return []
    
    policies = []
    for policy_file in POLICIES_DIR.glob("*.json"):
        try:
            with open(policy_file, "r", encoding="utf-8") as f:
                policy = json.load(f)
                policies.append({
                    "filename": policy_file.name,
                    "platform": policy.get("platform", "Unknown"),
                    "region": policy.get("region", "Unknown"),
                    "version": policy.get("version", "1.0")
                })
        except Exception:
            pass
    
    return policies


# Pre-load common policies on module import
def _preload_policies():
    """Pre-load common policies into cache."""
    common = [
        ("YouTube", "United States"),
        ("YouTube", "Middle East"),
    ]
    for platform, region in common:
        load_policy(platform, region)


# Initialize on import
if POLICIES_DIR.exists():
    _preload_policies()
