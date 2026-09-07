from datetime import date
import unittest

from query_parser import (
    build_prompt, match_person, parse_response, resolve_period, to_facets,
)

TODAY = date(2026, 9, 7)  # a Monday
PEOPLE = [
    {"label": "Jen Teagle", "cluster_id": "c-jen", "category": "people"},
    {"label": "Ady LeBaron", "cluster_id": "c-ady", "category": "people"},
    {"label": "Rex", "cluster_id": "c-rex", "category": "pets"},
]


class PromptTests(unittest.TestCase):
    def test_the_prompt_carries_the_names_the_model_may_choose_from(self):
        prompt = build_prompt("videos of jen", [p["label"] for p in PEOPLE])
        self.assertIn("Jen Teagle", prompt)
        self.assertIn("videos of jen", prompt)

    def test_an_empty_library_still_produces_a_usable_prompt(self):
        self.assertIn("(none)", build_prompt("sunset", []))


class ParseResponseTests(unittest.TestCase):
    def test_reads_plain_json(self):
        self.assertEqual(parse_response('{"media":"video"}'), {"media": "video"})

    def test_reads_json_out_of_a_fenced_block(self):
        raw = 'Sure!\n```json\n{"media":"photo"}\n```\nHope that helps'
        self.assertEqual(parse_response(raw), {"media": "photo"})

    def test_reads_json_surrounded_by_chatter(self):
        self.assertEqual(parse_response('Here you go: {"media":"all"} ok?'), {"media": "all"})

    def test_unparseable_output_is_none_rather_than_an_exception(self):
        for raw in ("", None, "I don't know", "{not json}", "[1,2,3]"):
            self.assertIsNone(parse_response(raw))


class ResolvePeriodTests(unittest.TestCase):
    def test_simple_days(self):
        self.assertEqual(resolve_period("today", TODAY), ("2026-09-07", "2026-09-07"))
        self.assertEqual(resolve_period("yesterday", TODAY), ("2026-09-06", "2026-09-06"))

    def test_last_week_is_the_previous_whole_week(self):
        self.assertEqual(resolve_period("last_week", TODAY), ("2026-08-31", "2026-09-06"))

    def test_last_month_handles_the_year_boundary(self):
        self.assertEqual(resolve_period("last_month", TODAY), ("2026-08-01", "2026-08-31"))
        self.assertEqual(resolve_period("last_month", date(2026, 1, 15)),
                         ("2025-12-01", "2025-12-31"))

    def test_last_year_is_the_whole_year(self):
        self.assertEqual(resolve_period("last_year", TODAY), ("2025-01-01", "2025-12-31"))

    def test_last_summer_means_this_years_if_it_has_finished(self):
        # On 7 September, summer (Jun-Aug) has ended, so it means this year's.
        self.assertEqual(resolve_period("last_summer", TODAY), ("2026-06-01", "2026-08-31"))

    def test_last_summer_means_the_previous_years_if_it_has_not(self):
        self.assertEqual(resolve_period("last_summer", date(2026, 7, 1)),
                         ("2025-06-01", "2025-08-31"))

    def test_winter_spans_the_year_boundary(self):
        self.assertEqual(resolve_period("last_winter", TODAY), ("2025-12-01", "2026-02-28"))

    def test_explicit_year_and_month(self):
        self.assertEqual(resolve_period("year:2019", TODAY), ("2019-01-01", "2019-12-31"))
        self.assertEqual(resolve_period("month:2019-02", TODAY), ("2019-02-01", "2019-02-28"))

    def test_february_in_a_leap_year(self):
        self.assertEqual(resolve_period("month:2024-02", TODAY), ("2024-02-01", "2024-02-29"))

    def test_relative_windows(self):
        self.assertEqual(resolve_period("last_30_days", TODAY), ("2026-08-08", "2026-09-07"))

    def test_nonsense_and_invalid_values_resolve_to_nothing(self):
        for token in (None, "", "someday", "year:abcd", "month:2019-13", 42, "last__days"):
            self.assertIsNone(resolve_period(token, TODAY))


class MatchPersonTests(unittest.TestCase):
    def test_exact_and_case_insensitive_matches(self):
        self.assertEqual(match_person("Jen Teagle", PEOPLE)["cluster_id"], "c-jen")
        self.assertEqual(match_person("jen teagle", PEOPLE)["cluster_id"], "c-jen")

    def test_a_first_name_reaches_the_only_person_who_has_it(self):
        self.assertEqual(match_person("Jen", PEOPLE)["cluster_id"], "c-jen")

    def test_an_ambiguous_first_name_matches_nobody(self):
        people = PEOPLE + [{"label": "Jen Smith", "cluster_id": "c-jen2", "category": "people"}]
        self.assertIsNone(match_person("Jen", people))

    def test_a_name_the_library_does_not_hold_matches_nobody(self):
        # The model is free to hallucinate a name; it must not become a filter.
        self.assertIsNone(match_person("Napoleon", PEOPLE))
        self.assertIsNone(match_person(None, PEOPLE))
        self.assertIsNone(match_person("", PEOPLE))


class ToFacetsTests(unittest.TestCase):
    def test_the_worked_example(self):
        facets = to_facets(
            {"media": "video", "person": "Jen", "period": "last_summer", "text": None},
            PEOPLE, TODAY,
        )
        self.assertEqual(facets["media"], "video")
        self.assertEqual(facets["cluster_id"], "c-jen")
        self.assertEqual(facets["category"], "people")
        self.assertEqual((facets["date_from"], facets["date_to"]),
                         ("2026-06-01", "2026-08-31"))
        self.assertEqual(facets["text"], "")

    def test_a_purely_visual_query_keeps_its_text_and_adds_no_filters(self):
        facets = to_facets(
            {"media": "all", "person": None, "period": None, "text": "sunset over water"},
            PEOPLE, TODAY,
        )
        self.assertEqual(facets["text"], "sunset over water")
        self.assertIsNone(facets["cluster_id"])
        self.assertIsNone(facets["date_from"])

    def test_an_invented_media_kind_falls_back_to_all(self):
        self.assertEqual(to_facets({"media": "gifs"}, PEOPLE, TODAY)["media"], "all")

    def test_a_hallucinated_person_never_becomes_a_filter(self):
        facets = to_facets({"person": "Napoleon Bonaparte"}, PEOPLE, TODAY)
        self.assertIsNone(facets["cluster_id"])

    def test_an_invented_period_never_becomes_a_date_filter(self):
        facets = to_facets({"period": "whenever"}, PEOPLE, TODAY)
        self.assertIsNone(facets["date_from"])

    def test_sql_shaped_output_is_discarded_not_passed_through(self):
        facets = to_facets(
            {"media": "video'; DROP TABLE photos;--",
             "person": "'; DELETE FROM users;--",
             "period": "year:2019); DROP TABLE photos;--"},
            PEOPLE, TODAY,
        )
        self.assertEqual(facets["media"], "all")
        self.assertIsNone(facets["cluster_id"])
        self.assertIsNone(facets["date_from"])

    def test_garbage_input_yields_a_harmless_empty_facet_set(self):
        for bad in (None, "not a dict", [], 42):
            facets = to_facets(bad, PEOPLE, TODAY)
            self.assertEqual(facets["media"], "all")
            self.assertEqual(facets["text"], "")


if __name__ == "__main__":
    unittest.main()
