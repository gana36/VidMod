import os
import logging
from google.cloud import storage
from google.auth import default, impersonated_credentials
from google.auth.transport.requests import Request
from datetime import timedelta

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_gcs_connectivity():
    print("--- Starting GCS Connectivity Test ---")
    
    # 1. Load Env (simulated)
    bucket_name = os.getenv("GCS_BUCKET_NAME")
    project_id = os.getenv("GCS_PROJECT_ID")
    sa_email = os.getenv("GCS_SERVICE_ACCOUNT_EMAIL")
    
    print(f"Entities: Project={project_id}, Bucket={bucket_name}, SA={sa_email}")
    
    if not bucket_name:
        print("❌ ERROR: GCS_BUCKET_NAME not set")
        return

    # 2. Initialize Client
    try:
        if project_id:
            client = storage.Client(project=project_id)
        else:
            client = storage.Client()
        print("✅ GCS Client Initialized")
    except Exception as e:
        print(f"❌ ERROR: Failed to init GCS client: {e}")
        return

    # 3. Check Bucket Access
    try:
        bucket = client.bucket(bucket_name)
        if bucket.exists():
            print(f"✅ Bucket '{bucket_name}' exists and is accessible")
        else:
            print(f"❌ ERROR: Bucket '{bucket_name}' does not exist or 403 Forbidden")
            return
    except Exception as e:
        print(f"❌ ERROR: Failed to check bucket: {e}")
        return

    # 4. Test IAM Signing (The critical part)
    print("\n--- Testing IAM Signed URL Generation ---")
    blob_name = "test_signed_url_check.txt"
    blob = bucket.blob(blob_name)
    
    try:
        # Standard signing (will fail on Cloud Run default)
        print("Attempting standard signing...")
        url = blob.generate_signed_url(
            version="v4", 
            expiration=timedelta(minutes=10),
            method="PUT"
        )
        print(f"✅ Standard Signing Success: {url[:50]}...")
    except Exception as e:
        print(f"⚠️ Standard Signing Failed (Expected on Cloud Run): {e}")
        
        # Fallback Signing
        print("\nAttempting IAM Fallback Signing...")
        try:
            creds, _ = default()
            
            if not sa_email:
                sa_email = getattr(creds, "service_account_email", "default")
            
            print(f"Target Service Account: {sa_email}")
            
            target_creds = impersonated_credentials.Credentials(
                source_credentials=creds,
                target_principal=sa_email,
                target_scopes=["https://www.googleapis.com/auth/cloud-platform"],
                lifetime=3600
            )
            
            request = Request()
            target_creds.refresh(request)
            print("✅ Impersonated Credentials Created")
            
            url = blob.generate_signed_url(
                version="v4",
                expiration=timedelta(minutes=10),
                method="PUT",
                credentials=target_creds
            )
            print(f"✅ IAM Signing Success: {url[:50]}...")
            
        except Exception as iam_e:
            print(f"❌ ERROR: IAM Signing Failed: {iam_e}")

if __name__ == "__main__":
    test_gcs_connectivity()
