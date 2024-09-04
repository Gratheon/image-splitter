CREATE DATABASE logs;

create table logs.logs
(
    id        int auto_increment
        primary key,
    level     varchar(16)   not null,
    message   varchar(2048) not null,
    meta      varchar(2048) not null,
    timestamp datetime      not null
);