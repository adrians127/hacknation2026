cmake_minimum_required(VERSION 3.28)

project(nmap-worker
  VERSION 0.0.0
  DESCRIPTION "SubSurf scan worker (nmap)"
  LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

find_package(CURL REQUIRED)
find_package(Threads REQUIRED)
find_path(NLOHMANN_JSON_INCLUDE_DIR nlohmann/json.hpp REQUIRED)
find_path(PUGIXML_INCLUDE_DIR pugixml.hpp REQUIRED)
find_library(PUGIXML_LIBRARY pugixml REQUIRED)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

add_executable(nmap-worker
  src/address.cpp
  src/http_client.cpp
  src/json_codec.cpp
  src/main.cpp
  src/nmap_process.cpp
  src/nmap_xml.cpp
  src/scan_engine.cpp
)

target_include_directories(nmap-worker PRIVATE
  ${NLOHMANN_JSON_INCLUDE_DIR}
  ${PUGIXML_INCLUDE_DIR}
)

target_link_libraries(nmap-worker PRIVATE
  CURL::libcurl
  Threads::Threads
  ${PUGIXML_LIBRARY}
)

target_compile_definitions(nmap-worker PRIVATE
  NMAP_WORKER_VERSION="${PROJECT_VERSION}"
)

target_compile_options(nmap-worker PRIVATE
  -Wall -Wextra -Wpedantic -Wshadow -Wconversion -Werror
)

install(TARGETS nmap-worker RUNTIME DESTINATION bin)

include(CTest)
if(BUILD_TESTING)
  find_package(Python3 COMPONENTS Interpreter QUIET)
  if(Python3_Interpreter_FOUND)
    add_test(NAME nmap-worker-integration
      COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/tests/test_worker.py $<TARGET_FILE:nmap-worker>)
    add_test(NAME nmap-worker-real-scan
      COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/tests/test_smoke.py $<TARGET_FILE:nmap-worker>)
  endif()
endif()
