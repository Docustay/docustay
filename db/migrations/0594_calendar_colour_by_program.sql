-- 0594 · the calendar can be coloured BY PROGRAM (QUEUE §4). Widens the 0403 check; additive (every existing value stays legal).
ALTER TABLE keystone.app_user DROP CONSTRAINT app_user_calendar_colour_check;
ALTER TABLE keystone.app_user ADD CONSTRAINT app_user_calendar_colour_check CHECK (calendar_colour_by IN ('service', 'staff', 'state', 'program'));
