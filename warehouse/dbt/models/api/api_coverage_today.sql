{{ config(materialized='view') }}

with latest as (
    select max("date") as d from {{ source('bronze', 'bronze_discovery_daily') }}
)

select
    d."date",
    sum(case when qualified then 1 else 0 end) as qualified_zips,
    count(distinct zip)                         as total_zips,
    (
        select count(*)
        from {{ source('bronze', 'bronze_panel_show_only_daily') }} p
        where p."date" = d."date"
    )                                           as panel_size
from {{ source('bronze', 'bronze_discovery_daily') }} d
cross join latest
where d."date" = latest.d
group by d."date"
