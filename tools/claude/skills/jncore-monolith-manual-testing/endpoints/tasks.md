# Tasks

Lane D. CRUD plus a second activity producer on the completion path.

| Action | Call | Activity |
|---|---|---|
| Create | `POST /api1/tasks` | Task Created |
| Modify | `PUT /api1/tasks/:docid` | Task Modified |
| Delete | `PUT /api1/tasks/:docid` with `is_active: false` | Task Deleted |
| Undelete | `POST /api1/tasks/:docid/undelete` | Task Undeleted |
| Complete | `PUT /api1/tasks/:docid` flipping completion | Task Modified **and** Task Completed |

```bash
A2125_RUN_ID=<id> node lanes/d-task.mjs
```

## Gotchas

- Completion goes through `helpers/activity-helper.js` and emits an **extra** activity on top of
  the Modified one. Two activities from one call is correct here.
- Task creation needs a task type and dates; `Meeting` is a safe type in dev.
- Incompletion is the mirror case and produces Task Incompleted.
