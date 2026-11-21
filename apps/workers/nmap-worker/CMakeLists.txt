cmake_minimum_required(VERSION 3.28)

project(nmap-worker
  VERSION 0.0.0
  DESCRIPTION "Attack Surface Intelligence scan worker (nmap)"
  LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

add_executable(nmap-worker
  src/main.cpp
)

target_compile_definitions(nmap-worker PRIVATE
  NMAP_WORKER_VERSION="${PROJECT_VERSION}"
)

target_compile_options(nmap-worker PRIVATE
  -Wall -Wextra -Wpedantic -Wshadow -Wconversion -Werror
)

install(TARGETS nmap-worker RUNTIME DESTINATION bin)
