import uuid
import random
from locust import HttpUser, task, between


class SurveyLoadTestUser(HttpUser):
    # Simulate user reading and completing form, with delay between 1 and 3 seconds
    wait_time = between(1, 3)

    # Sample pathology patterns to simulate realistic distribution
    SAMPLE_PATTERNS = [
        # Pattern 1: Benign serous tumor
        {
            "pathology": {
                "selected": [{"id": "serous_benign"}]
            },
            "classification": "benign"
        },
        # Pattern 2: High grade serous with mucinous children
        {
            "pathology": {
                "selected": [
                    {
                        "id": "serous_carcinoma_high_grade",
                        "children": [
                            {"id": "mucinous_borderline"},
                            {"id": "mucinous_carcinoma"}
                        ]
                    }
                ]
            },
            "classification": "malignant"
        },
        # Pattern 3: Endometrioid with clear cell child
        {
            "pathology": {
                "selected": [
                    {
                        "id": "endometrioid_carcinoma",
                        "children": [
                            {"id": "clear_cell_borderline"}
                        ]
                    }
                ]
            },
            "classification": "borderline"
        },
        # Pattern 4: Yolk sac tumor with other text
        {
            "pathology": {
                "selected": [
                    {
                        "id": "yolk_sac_tumor",
                        "children": [
                            {"id": "follicular_cyst"},
                            {"id": "pathology_other"}
                        ]
                    }
                ],
                "other_text": "Khối u buồng trứng hỗn hợp"
            },
            "classification": "malignant"
        },
        # Pattern 5: Mature teratoma
        {
            "pathology": {
                "selected": [{"id": "mature_teratoma"}]
            },
            "classification": "benign"
        }
    ]

    @task(10)
    def submit_survey(self):
        """Submit a realistic survey response with a freshly generated UUID."""
        pattern = random.choice(self.SAMPLE_PATTERNS)
        sub_uuid = str(uuid.uuid4())

        payload = {
            "submission_uuid": sub_uuid,
            "form_version": 1,
            "answers": pattern
        }

        with self.client.post(
            "/api/v1/submissions",
            json=payload,
            catch_response=True,
            name="POST /api/v1/submissions"
        ) as response:
            if response.status_code == 201:
                response.success()
            elif response.status_code == 200 and "Idempotent" in response.text:
                response.success()
            else:
                response.failure(f"Unexpected status: {response.status_code} - {response.text}")

    @task(1)
    def check_health(self):
        """Occasional health check probe."""
        self.client.get("/health/ready", name="GET /health/ready")
