"""Local staff profile shown in the app and returned by /v1/me."""


def session_profile(
    user: dict | None,
    teacher=None,
    institution: str | None = None,
) -> dict:
    user = user or {}
    roles = user.get("roles") or []
    teacher_resource_id = None
    teacher_name = user.get("name")
    if teacher is not None:
        teacher_resource_id = getattr(teacher, "resource_id", None)
        resource = getattr(teacher, "resource", None)
        if resource and getattr(resource, "name", None):
            teacher_name = resource.name
    return {
        "name": user.get("name"),
        "email": user.get("email"),
        "username": user.get("username"),
        "sub": user.get("sub"),
        "roles": roles,
        "teacher_resource_id": teacher_resource_id,
        "teacher_name": teacher_name,
        "can_construct": "scheduler_admin" in roles or "constructor" in roles,
        "institution": institution if institution is not None else user.get("institution"),
    }
