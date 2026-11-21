# Run by the defectdojo-initializer service: `python manage.py shell < set-api-token.py`.
# Pins the admin's API token to DD_API_TOKEN, so the backend can use a known value
# instead of one copied from the UI after every fresh volume. Idempotent.
import os
import sys

from django.contrib.auth import get_user_model
from django.db.models import Q
from rest_framework.authtoken.models import Token

username = os.environ["DD_ADMIN_USER"]
key = os.environ.get("DD_API_TOKEN", "").strip()

if not key:
    print("DD_API_TOKEN is empty; API tokens left untouched")
elif len(key) > 40:
    sys.exit("DD_API_TOKEN must be at most 40 characters")
else:
    user = get_user_model().objects.get(username=username)
    if Token.objects.filter(user=user, key=key).exists():
        print(f"API token for '{username}' already matches DD_API_TOKEN")
    else:
        # The key is the primary key, so it is also taken away from any other user holding it.
        Token.objects.filter(Q(user=user) | Q(key=key)).delete()
        Token.objects.create(user=user, key=key)
        print(f"API token for '{username}' set from DD_API_TOKEN")
