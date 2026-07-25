{% macro drop_indexes_on_relation(relation) -%}
  {#--
    Override of the dbt-duckdb built-in macro.

    The built-in version queries duckdb_indexes() without filtering by
    database_name. When MotherDuck attaches multiple databases in the same
    session (e.g. HFA alongside HFA_DEV), it finds indexes from other
    databases and tries to DROP them by short name, which fails.

    Fix: add database_name = relation.database to the lookup so we only
    drop indexes that actually belong to the relation we're replacing.
  --#}
  {% call statement('get_indexes_on_relation', fetch_result=True) %}
    SELECT index_name
    FROM duckdb_indexes()
    WHERE database_name = '{{ relation.database }}'
      AND schema_name   = '{{ relation.schema }}'
      AND table_name    = '{{ relation.identifier }}'
  {% endcall %}

  {% set results = load_result('get_indexes_on_relation').table %}
  {% for row in results %}
    {% set index_name = row[0] %}
    {% call statement('drop_index_' + loop.index|string, auto_begin=false) %}
      DROP INDEX "{{ relation.schema }}"."{{ index_name }}"
    {% endcall %}
  {% endfor %}

  {#-- Verify --#}
  {% call statement('verify_indexes_dropped', fetch_result=True) %}
    SELECT COUNT(*) as remaining_indexes
    FROM duckdb_indexes()
    WHERE database_name = '{{ relation.database }}'
      AND schema_name   = '{{ relation.schema }}'
      AND table_name    = '{{ relation.identifier }}'
  {% endcall %}
{% endmacro %}
